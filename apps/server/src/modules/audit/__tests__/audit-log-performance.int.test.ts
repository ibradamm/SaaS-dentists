import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { createUser } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import type { Clinic } from '../../../db/schema';
import type { UserActor } from '../../auth/auth.types';
import { createAuditLogService } from '../audit-log.service';

/*
 * Volume : une année de journal pour deux cabinets, 400 000 entrées chacun (environ 1 100 par
 * jour : connexions, fiches, rendez-vous, encaissements). Mesure une page du journal pour les
 * filtres courants et une action rare sur toute l'année (docs/adr/0011).
 */
const PER_CLINIC = 400_000;

describe("journal d'audit : performance avec une année d'entrées", () => {
  const t = openTestDatabase({ appPoolMax: 2 });
  const service = createAuditLogService({ db: t.appDb });
  let clinic: Clinic;
  let admin: UserActor;
  const actorIds: string[] = [];

  async function seed(c: Clinic, users: readonly string[]) {
    const client = await t.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.clinic_id', $1, true)", [c.id]);
      // Une entrée sur 200 est une note médicale ajoutée (action rare) ; les autres tournent
      // sur des actions courantes. 5 000 patients distincts.
      await client.query(
        `INSERT INTO audit_logs (id, clinic_id, actor_type, actor_id, action, entity_type, entity_id, created_at)
         SELECT gen_random_uuid(), $1::uuid, 'USER', ($2::uuid[])[1 + i % cardinality($2::uuid[])],
                CASE WHEN i % 200 = 0 THEN 'patient.medical_note_added'
                     ELSE (ARRAY['auth.login_succeeded','patient.updated','appointment.created',
                                 'appointment.status_changed','charge.created','payment.recorded',
                                 'patient.medical_notes_read'])[1 + i % 7] END,
                'patient', p.ids[1 + i % 5000],
                timestamptz '2025-09-28 07:00:00+00' + i * interval '78 seconds'
           FROM generate_series(1, $3::int) AS i,
                (SELECT array_agg(gen_random_uuid()) AS ids FROM generate_series(1, 5000)) AS p`,
        [c.id, users, PER_CLINIC],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    admin = actorFor((await createUser(t.ownerDb, clinic.id, 'ADMIN')).id, 'ADMIN', clinic.id);
    for (const role of ['DENTIST', 'DENTIST', 'SECRETARY', 'SECRETARY', 'ADMIN'] as const) {
      actorIds.push((await createUser(t.ownerDb, clinic.id, role)).id);
    }
    const other = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    const otherUser = (await createUser(t.ownerDb, other.id, 'ADMIN')).id;
    await seed(clinic, actorIds);
    await seed(other, [otherUser]);
    await t.ownerPool.query('ANALYZE audit_logs');
  }, 180_000);
  afterAll(() => t.close());

  it('une page en moins d’une seconde, quel que soit le filtre, sur toute l’année', async () => {
    const year = { from: '2025-09-28', to: '2026-09-27' };
    const patient = (await service.list(admin, { ...year, limit: 1 })).entries[0]!.entityId!;
    const cases: [string, Record<string, unknown>][] = [
      ['sans filtre', year],
      ['un utilisateur', { ...year, actorId: actorIds[2] }],
      ['action rare', { ...year, action: 'patient.medical_note_added' }],
      ['un élément', { ...year, entityType: 'patient', entityId: patient }],
      [
        'utilisateur et action rare',
        { ...year, actorId: actorIds[0], action: 'patient.medical_note_added' },
      ],
      ['une journée', { from: '2026-03-29', to: '2026-03-29' }],
    ];
    const report: Record<string, string> = {};
    for (const [label, query] of cases) {
      await service.list(admin, query); // préchauffage
      const start = performance.now();
      const page = await service.list(admin, query);
      const ms = performance.now() - start;
      report[label] = `${ms.toFixed(0)} ms, ${page.entries.length} entrées`;
      expect(page.entries.length, label).toBeGreaterThan(0);
      expect(ms, label).toBeLessThan(500);
    }
    // Pagination profonde : 20e page d'une action courante.
    let cursor: string | undefined;
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      const page = await service.list(admin, {
        ...year,
        action: 'appointment.created',
        ...(cursor ? { before: cursor } : {}),
      });
      cursor = page.nextCursor ?? undefined;
    }
    report['20 pages successives'] = `${(performance.now() - start).toFixed(0)} ms`;
    expect(cursor).toBeDefined();
    // Plan d'exécution (déterministe, contrairement aux durées) : lecture dans l'ordre de
    // l'index, sans tri de toute la période, avec ou sans curseur.
    const client = await t.appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.clinic_id', $1, true)", [clinic.id]);
      for (const extra of [
        '',
        `AND a.action = 'appointment.created' AND (a.created_at, a.id) <
           (SELECT c.created_at, c.id FROM audit_logs c WHERE c.id = '${cursor}')`,
      ]) {
        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT a.id FROM audit_logs a
            WHERE a.clinic_id = '${clinic.id}' AND a.created_at >= '2025-09-27T22:00:00Z'
              AND a.created_at < '2026-09-27T22:00:00Z' ${extra}
            ORDER BY a.created_at DESC, a.id DESC LIMIT 51`,
        );
        const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
        expect(plan).toMatch(/Index (Only )?Scan using audit_logs_clinic_created_id_idx/);
        expect(plan).not.toMatch(/Sort|Seq Scan on audit_logs a/);
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    process.stdout.write(
      `\nJournal d'audit (${PER_CLINIC} entrées par cabinet) : ${JSON.stringify(report, null, 2)}\n`,
    );
  }, 120_000);
});
