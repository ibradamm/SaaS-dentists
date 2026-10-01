import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { actorFor } from '../../../test/actors';
import { META, createTestAuth, createUser } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { reviewRetention } from '../../jobs/retention';
import { createSecretBox } from '../../lib/secret-box';
import { createPatientsService } from '../../modules/patients/patients.service';
import {
  CLINIC_TABLES,
  GLOBAL_TABLES,
  PurgeRefused,
  exportClinicData,
  purgeClinicData,
} from '../admin/clinic-data';
import { setClinicStatus, setLegalHold } from '../admin/clinics';
import type { Clinic } from '../schema';
import { withTenant } from '../tenant';

const NOTE = 'Allergie sentinelle-0909';

/**
 * Données d'un cabinet en fin de contrat (docs/adr/0014) : catalogue des tables, export de
 * restitution, suspension, conservation pour litige et purge sur instruction.
 */
describe('données d’un cabinet : restitution et purge', () => {
  const t = openTestDatabase();
  const secretBox = createSecretBox(randomBytes(32));
  const patients = createPatientsService({ db: t.appDb, secretBox });
  const { adminUrl, databaseName } = inject('database');
  const adminDbUrl = new URL(adminUrl);
  adminDbUrl.pathname = `/${databaseName}`;
  const adminPool = new pg.Pool({ connectionString: adminDbUrl.toString(), max: 1 });

  let a: Clinic;
  let b: Clinic;
  const of = new Map<string, { patientId: string; secretaryId: string }>();
  let sharedUserId: string;

  /** Un dossier complet : comptes, session, patient, note, rendez-vous, acte, encaissement, import. */
  async function populate(clinic: Clinic) {
    const secretary = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
    const dentist = await createUser(t.ownerDb, clinic.id, 'DENTIST');
    const patient = await patients.create(
      actorFor(secretary.id, 'SECRETARY', clinic.id),
      { lastName: 'Bennani', firstName: 'Salma', birthDate: '1980-05-17', contacts: [] },
      META,
    );
    await patients.addMedicalNote(
      actorFor(dentist.id, 'DENTIST', clinic.id),
      patient.id,
      NOTE,
      META,
    );
    await createTestAuth(t.appDb).auth.login(
      { email: secretary.email, password: secretary.password },
      META,
    );
    await withTenant(t.ownerDb, clinic.id, async (tx) => {
      await tx.execute(sql`
        WITH pr AS (
          INSERT INTO practitioners (id, clinic_id, display_name, color)
          VALUES (gen_random_uuid(), ${clinic.id}, 'Dr Test', '#123456') RETURNING id),
        ty AS (
          INSERT INTO appointment_types (id, clinic_id, name, duration_minutes, color)
          VALUES (gen_random_uuid(), ${clinic.id}, 'Contrôle', 30, '#654321') RETURNING id),
        ap AS (
          INSERT INTO appointments (id, clinic_id, practitioner_id, patient_id, appointment_type_id, start_at, end_at)
          SELECT gen_random_uuid(), ${clinic.id}, pr.id, ${patient.id}, ty.id,
                 '2026-03-02T09:00Z', '2026-03-02T09:30Z'
          FROM pr, ty RETURNING id, practitioner_id)
        INSERT INTO charges (id, clinic_id, patient_id, appointment_id, practitioner_id, label, amount_cents, currency, idempotency_key)
        SELECT gen_random_uuid(), ${clinic.id}, ${patient.id}, ap.id, ap.practitioner_id, 'Acte', 30000, 'EUR', gen_random_uuid()
        FROM ap`);
      await tx.execute(sql`
        INSERT INTO payments (id, clinic_id, patient_id, charge_id, amount_cents, currency, method, idempotency_key)
        SELECT gen_random_uuid(), clinic_id, patient_id, id, amount_cents, 'EUR', 'CASH', gen_random_uuid()
        FROM charges WHERE clinic_id = ${clinic.id}`);
      await tx.execute(sql`
        WITH ba AS (
          INSERT INTO import_batches (id, clinic_id, kind, status, file_name, date_format, total_rows, counts, created_by)
          VALUES (gen_random_uuid(), ${clinic.id}, 'PATIENTS', 'COMMITTED', 'fichier.csv', 'DD/MM/YYYY', 1,
                  '{"received":1,"valid":1,"invalid":0,"duplicates":0,"existing":0,"imported":1}', ${secretary.id})
          RETURNING id)
        INSERT INTO import_rows (id, clinic_id, batch_id, line, status, data, issues)
        SELECT gen_random_uuid(), ${clinic.id}, ba.id, 2, 'VALID', '{"lastName":"Importé"}', '[]' FROM ba`);
    });
    of.set(clinic.id, { patientId: patient.id, secretaryId: secretary.id });
  }

  /** Lignes du cabinet dans chaque table du catalogue (connexion administrateur, hors RLS). */
  async function countsOf(clinicId: string) {
    const counts: Record<string, number> = {};
    for (const table of CLINIC_TABLES) {
      const { rows } = await adminPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE clinic_id = $1`,
        [clinicId],
      );
      counts[table] = rows[0]!.n;
    }
    return counts;
  }

  async function purge(clinic: Clinic, confirmName: string, execute: boolean) {
    const client = await adminPool.connect();
    try {
      return await purgeClinicData(client, { clinicId: clinic.id, confirmName, execute });
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    a = await createTestClinic(t.ownerDb);
    b = await createTestClinic(t.ownerDb);
    await populate(a);
    await populate(b);
    // Compte de deux cabinets : il doit survivre à la purge de l'un d'eux.
    sharedUserId = (await createUser(t.ownerDb, b.id, 'SECRETARY')).id;
    await withTenant(t.ownerDb, a.id, (tx) =>
      tx.execute(sql`INSERT INTO clinic_memberships (id, clinic_id, user_id, role)
                     VALUES (gen_random_uuid(), ${a.id}, ${sharedUserId}, 'SECRETARY')`),
    );
  });
  afterAll(async () => {
    await adminPool.end();
    await t.close();
  });

  it('catalogue : toute table du schéma public est classée (cabinet ou globale)', async () => {
    const { rows } = await t.ownerPool.query<{ table: string; per_clinic: boolean }>(`
      SELECT c.relname AS table,
             EXISTS (SELECT 1 FROM information_schema.columns k
                     WHERE k.table_schema = 'public' AND k.table_name = c.relname
                       AND k.column_name = 'clinic_id') AS per_clinic
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`);
    const perClinic = rows.filter((r) => r.per_clinic).map((r) => r.table);
    const global = rows.filter((r) => !r.per_clinic).map((r) => r.table);
    expect([...perClinic].sort()).toEqual([...CLINIC_TABLES].sort());
    expect([...global].sort()).toEqual([...GLOBAL_TABLES].sort());
  });

  it('export : tout le cabinet et rien d’un autre ; notes déchiffrées ; aucun secret', async () => {
    const exported = await exportClinicData(t.appDb, a.id, secretBox);
    const json = JSON.stringify(exported);
    expect(Object.keys(exported.data).sort()).toEqual(
      ['clinics', 'users', ...CLINIC_TABLES.filter((x) => x !== 'sessions')].sort(),
    );
    expect(exported.counts).toMatchObject({
      clinics: 1,
      users: 3,
      patients: 1,
      patient_medical_notes: 1,
      appointments: 1,
      charges: 1,
      payments: 1,
      import_rows: 1,
    });
    expect(exported.counts.audit_logs).toBeGreaterThan(0);
    // Date de naissance telle que saisie, sans passage par le fuseau du serveur.
    expect(exported.data.patients![0]).toMatchObject({ birth_date: '1980-05-17' });
    expect(exported.data.patient_medical_notes![0]).toMatchObject({ content: NOTE });
    expect(exported.data.patient_medical_notes![0]).not.toHaveProperty('content_enc');
    for (const user of exported.data.users!) {
      expect(Object.keys(user).sort()).toEqual([
        'created_at',
        'email',
        'full_name',
        'id',
        'status',
      ]);
    }
    expect(json).not.toMatch(/password|mfa_secret|token_hash|csrf/);
    expect(json).not.toContain(of.get(b.id)!.patientId);
    await expect(
      exportClinicData(t.appDb, '00000000-0000-7000-8000-000000000001', secretBox),
    ).rejects.toThrow('Cabinet introuvable');
  });

  it('le rôle applicatif ne peut ni suspendre un cabinet ni poser ou lever une conservation pour litige', async () => {
    for (const statement of [
      sql`UPDATE clinics SET status = 'SUSPENDED' WHERE id = ${a.id}`,
      sql`UPDATE clinics SET legal_hold_since = now() WHERE id = ${a.id}`,
    ]) {
      await expect(withTenant(t.appDb, a.id, (tx) => tx.execute(statement))).rejects.toMatchObject({
        cause: { code: '42501' },
      });
    }
  });

  it('purge refusée : cabinet actif, sous litige, confirmation inexacte, connexion non administrateur', async () => {
    await expect(purge(a, a.name, true)).rejects.toThrow(new PurgeRefused('cabinet non suspendu'));
    expect(await setClinicStatus(t.ownerDb, a.id, 'SUSPENDED')).toBe(true);
    expect(await setLegalHold(t.ownerDb, a.id, true)).toBe(true);
    await expect(purge(a, a.name, true)).rejects.toThrow('cabinet sous conservation pour litige');
    expect(await setLegalHold(t.ownerDb, a.id, false)).toBe(true);
    await expect(purge(a, `${a.name} `, true)).rejects.toThrow(
      'la confirmation ne reproduit pas le nom du cabinet',
    );
    const owner = await t.ownerPool.connect();
    try {
      await expect(
        purgeClinicData(owner, { clinicId: a.id, confirmName: a.name, execute: true }),
      ).rejects.toThrow('connexion administrateur requise');
    } finally {
      owner.release();
    }
    expect((await countsOf(a.id)).patients).toBe(1);
  });

  it('simulation : volumes exacts, rien de supprimé', async () => {
    const before = await countsOf(a.id);
    const simulated = await purge(a, a.name, false);
    expect(simulated).toMatchObject({ executed: false, clinicName: a.name });
    expect(simulated.deleted).toMatchObject({ ...before, clinics: 1, users: 2 });
    expect(await countsOf(a.id)).toEqual(before);
  });

  it('purge exécutée : plus rien du cabinet, l’autre cabinet intact, le compte partagé conservé', async () => {
    const otherBefore = await countsOf(b.id);
    const done = await purge(a, a.name, true);
    expect(done.executed).toBe(true);
    expect(Object.values(await countsOf(a.id)).every((n) => n === 0)).toBe(true);
    const { rows: clinic } = await adminPool.query('SELECT 1 FROM clinics WHERE id = $1', [a.id]);
    expect(clinic).toEqual([]);
    const { rows: users } = await adminPool.query<{ id: string }>(
      'SELECT id FROM users WHERE id = ANY($1::uuid[])',
      [[of.get(a.id)!.secretaryId, sharedUserId]],
    );
    expect(users.map((u) => u.id)).toEqual([sharedUserId]);
    expect(await countsOf(b.id)).toEqual(otherBefore);
  });

  it('revue de conservation : mesure ce qui dépasse une durée, sans rien supprimer', async () => {
    const before = await countsOf(b.id);
    const review = (durations: Parameters<typeof reviewRetention>[3]) =>
      withTenant(t.appDb, b.id, (tx) =>
        reviewRetention(tx, b.id, new Date('2036-01-01T00:00:00Z'), durations),
      );
    const unset = await review({});
    expect(unset.map((l) => [l.category, l.records, l.beyond])).toEqual([
      ['patients', 1, null],
      ['charges', 1, null],
      ['payments', 1, null],
      ['audit_logs', before.audit_logs, null],
      ['import_rows', 1, null],
    ]);
    const set = await review({ patientInactiveDays: 365, billingDays: 3650, auditLogDays: 365 });
    expect(set.map((l) => [l.category, l.durationDays, l.beyond])).toEqual([
      ['patients', 365, 1],
      ['charges', 3650, 0],
      ['payments', 3650, 0],
      ['audit_logs', 365, before.audit_logs],
      ['import_rows', null, null],
    ]);
    expect(await countsOf(b.id)).toEqual(before);
  });
});
