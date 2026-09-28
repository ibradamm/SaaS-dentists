import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createUser } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { createLogger } from '../../config/logger';
import type { Clinic } from '../../db/schema';
import { SECURITY_POLICY as P } from '../../modules/auth/security-policy';
import { registerJobHandlers } from '../handlers';
import { createRuntimeJobQueue } from '../queue';
import { RETENTION_CRON, RETENTION_QUEUE, runRetention } from '../retention';

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * Conservation des données (docs/adr/0011) : sessions terminées depuis plus de 30 jours et
 * brouillons d'import de plus de 24 h supprimés chaque nuit, cabinet par cabinet, au moindre
 * privilège. Les horodatages sont relatifs à l'horloge réelle : la politique RLS de
 * suppression utilise celle de la base.
 */
describe('conservation des données : tâche quotidienne', () => {
  const t = openTestDatabase({ appPoolMax: 4 });
  const clinics: Clinic[] = [];
  /** Sessions par cabinet : ancienne terminée, récente révoquée, active. */
  const sessionsOf = new Map<string, Record<'old' | 'recent' | 'active', string>>();
  const draftsOf = new Map<string, Record<'stale' | 'fresh' | 'committed', string>>();

  /** Requêtes du rôle propriétaire dans le contexte d'un cabinet (RLS forcée pour lui aussi). */
  async function asOwner<T>(clinicId: string, sql: string, params: unknown[] = []) {
    const client = await t.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId]);
      const { rows } = await client.query<T & Record<string, unknown>>(sql, params);
      await client.query('COMMIT');
      return rows;
    } finally {
      client.release();
    }
  }
  async function session(clinicId: string, userId: string, at: { seen: string; revoked?: string }) {
    const [row] = await asOwner<{ id: string }>(
      clinicId,
      `INSERT INTO sessions (id, token_hash, clinic_id, user_id, state, csrf_token, created_at,
                             last_seen_at, expires_at, revoked_at, ip, user_agent)
       VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE', 'csrf', $4, $4, $4::timestamptz + interval '12 hours', $5,
               '203.0.113.9', 'navigateur')
       RETURNING id`,
      [randomBytes(16).toString('hex'), clinicId, userId, at.seen, at.revoked ?? null],
    );
    return row!.id;
  }
  async function draft(clinicId: string, userId: string, createdAt: string, status = 'DRAFT') {
    const [row] = await asOwner<{ id: string }>(
      clinicId,
      `INSERT INTO import_batches (id, clinic_id, kind, status, file_name, date_format, total_rows,
                                   counts, created_by, created_at)
       VALUES (gen_random_uuid(), $1, 'PATIENTS', $2, 'fichier.csv', 'DD/MM/YYYY', 1,
               '{"received":1,"valid":1,"invalid":0,"duplicates":0,"existing":0,"imported":0}', $3, $4)
       RETURNING id`,
      [clinicId, status, userId, createdAt],
    );
    await asOwner(
      clinicId,
      `INSERT INTO import_rows (id, clinic_id, batch_id, line, status, data, issues)
       VALUES (gen_random_uuid(), $1, $2, 2, 'VALID', '{"lastName":"Brouillon"}', '[]')`,
      [clinicId, row!.id],
    );
    return row!.id;
  }
  const exists = async (clinicId: string, table: string, id: string) =>
    (await asOwner(clinicId, `SELECT 1 FROM ${table} WHERE id = $1`, [id])).length === 1;

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const clinic = await createTestClinic(t.ownerDb);
      const user = (await createUser(t.ownerDb, clinic.id, 'ADMIN')).id;
      clinics.push(clinic);
      sessionsOf.set(clinic.id, {
        old: await session(clinic.id, user, { seen: ago(40 * DAY) }),
        recent: await session(clinic.id, user, { seen: ago(5 * DAY), revoked: ago(5 * DAY) }),
        active: await session(clinic.id, user, { seen: ago(60_000) }),
      });
      draftsOf.set(clinic.id, {
        stale: await draft(clinic.id, user, ago(2 * DAY)),
        fresh: await draft(clinic.id, user, ago(3_600_000)),
        committed: await draft(clinic.id, user, ago(10 * DAY), 'COMMITTED'),
      });
    }
  });
  afterAll(() => t.close());

  it('les durées de la politique SQL sont celles de SECURITY_POLICY', () => {
    const migration = readFileSync(
      fileURLToPath(new URL('../../db/migrations/0018_retention_security.sql', import.meta.url)),
      'utf8',
    );
    expect(migration).toContain(`interval '${P.sessionIdleMinutes} minutes'`);
    expect(migration).toContain(`interval '${P.sessionRetentionDays} days'`);
  });

  it('le rôle applicatif ne supprime aucune session récente, même sans condition', async () => {
    const [clinic] = clinics;
    const client = await t.appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.clinic_id', $1, true)", [clinic!.id]);
      // Requête « erronée » : sans aucune condition. La politique limite la suppression.
      const deleted = await client.query('DELETE FROM sessions RETURNING id');
      expect(deleted.rows.map((r: { id: string }) => r.id)).toEqual([
        sessionsOf.get(clinic!.id)!.old,
      ]);
      // Hors contexte, rien : ni sessions, ni cabinets (seule la liste des identifiants).
      await client.query("SELECT set_config('app.clinic_id', '', true)");
      expect((await client.query('DELETE FROM sessions RETURNING id')).rowCount).toBe(0);
      expect((await client.query('SELECT * FROM clinics')).rowCount).toBe(0);
      const ids = await client.query<{ id: string }>('SELECT app.maintenance_clinic_ids() AS id');
      expect(ids.rows.map((r) => r.id)).toEqual(expect.arrayContaining(clinics.map((c) => c.id)));
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('durée configurable : à 45 jours, une session terminée depuis 40 jours est conservée', async () => {
    const logger = createLogger({ service: 'worker', env: 'test', level: 'silent' });
    const report = await runRetention({ db: t.appDb, logger, sessionRetentionDays: 45 });
    // Les brouillons de plus de 24 h sont purgés quelle que soit la durée des sessions.
    expect(report.importDrafts).toBeGreaterThanOrEqual(2);
    for (const clinic of clinics) {
      expect(await exists(clinic.id, 'sessions', sessionsOf.get(clinic.id)!.old)).toBe(true);
    }
  });

  it('chaque cabinet : sessions terminées et brouillons abandonnés supprimés, le reste intact', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'worker',
      env: 'test',
      level: 'info',
      destination: { write: (line: string) => void lines.push(line) },
    });
    const report = await runRetention({ db: t.appDb, logger });
    expect(report.clinics).toBeGreaterThanOrEqual(2);
    expect(report.sessions).toBeGreaterThanOrEqual(2);
    for (const clinic of clinics) {
      const s = sessionsOf.get(clinic.id)!;
      expect(await exists(clinic.id, 'sessions', s.old)).toBe(false);
      expect(await exists(clinic.id, 'sessions', s.recent)).toBe(true);
      expect(await exists(clinic.id, 'sessions', s.active)).toBe(true);
      const d = draftsOf.get(clinic.id)!;
      const status = async (id: string) =>
        (
          await asOwner<{ status: string }>(
            clinic.id,
            'SELECT status FROM import_batches WHERE id = $1',
            [id],
          )
        )[0]?.status;
      const rows = async (id: string) =>
        (await asOwner(clinic.id, 'SELECT 1 FROM import_rows WHERE batch_id = $1', [id])).length;
      expect([await status(d.stale), await rows(d.stale)]).toEqual(['DISCARDED', 0]);
      expect([await status(d.fresh), await rows(d.fresh)]).toEqual(['DRAFT', 1]);
      expect([await status(d.committed), await rows(d.committed)]).toEqual(['COMMITTED', 1]);
    }
    // Journal : des compteurs, aucune donnée (ni adresse IP, ni nom).
    const log = lines.join('');
    expect(log).toContain('conservation des données appliquée');
    expect(log).not.toMatch(/203\.0\.113|Brouillon|navigateur/);
    // Deuxième passage : plus rien à supprimer.
    expect(await runRetention({ db: t.appDb, logger })).toMatchObject({
      sessions: 0,
      importDrafts: 0,
    });
  });

  it('le worker planifie la tâche chaque nuit et l’exécute (rôle applicatif)', async () => {
    const logger = createLogger({ service: 'worker', env: 'test', level: 'silent' });
    const boss: PgBoss = createRuntimeJobQueue(inject('database').appUrl, logger);
    await boss.start();
    try {
      expect(await registerJobHandlers(boss, { logger, pool: t.appPool, db: t.appDb })).toEqual([
        RETENTION_QUEUE,
      ]);
      const [schedule] = await boss.getSchedules(RETENTION_QUEUE);
      expect(schedule).toMatchObject({
        name: RETENTION_QUEUE,
        cron: RETENTION_CRON,
        timezone: 'UTC',
      });
      const clinic = clinics[0]!;
      const user = (await createUser(t.ownerDb, clinic.id, 'SECRETARY')).id;
      const old = await session(clinic.id, user, { seen: ago(45 * DAY) });
      const jobId = await boss.send(RETENTION_QUEUE, {});
      // La tâche parcourt tous les cabinets de la base de test (partagée avec les autres
      // fichiers) : on attend sa fin, pas seulement la suppression dans ce cabinet-ci.
      const state = async () => (await boss.getJobById(RETENTION_QUEUE, jobId!))?.state;
      for (let i = 0; i < 150 && !['completed', 'failed'].includes((await state()) ?? ''); i++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(await state()).toBe('completed');
      expect(await exists(clinic.id, 'sessions', old)).toBe(false);
    } finally {
      await boss.stop({ graceful: false });
    }
  });
});
