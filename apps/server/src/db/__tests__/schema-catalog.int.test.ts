import { afterAll, describe, expect, it } from 'vitest';
import { openTestDatabase } from '../../../test/db';
import { DB_APP_ROLE, DB_OWNER_ROLE } from '../roles';

/**
 * Garde-fou structurel : toute table du schéma public doit être protégée par RLS. Ce test
 * échoue si une migration ajoute une table sans RLS activée et forcée.
 */
describe('catalogue du schéma', () => {
  const t = openTestDatabase();
  afterAll(() => t.close());

  it('toute table du schéma public a la RLS activée, forcée et au moins une politique', async () => {
    const { rows } = await t.ownerPool.query<{
      table: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`);
    expect(rows.map((r) => r.table)).toEqual(
      expect.arrayContaining([
        'audit_logs',
        'clinic_memberships',
        'clinics',
        'sessions',
        'users',
        'patients',
        'practitioners',
        'appointment_types',
        'working_schedules',
        'working_intervals',
        'availability_blocks',
        'appointment_statuses',
        'appointments',
        'charges',
        'payments',
      ]),
    );
    const unprotected = rows
      .filter((r) => !r.rls || !r.forced || r.policies === 0)
      .map((r) => r.table);
    expect(unprotected).toEqual([]);
  });

  it("le rôle applicatif n'est ni superutilisateur, ni BYPASSRLS, ni propriétaire de table", async () => {
    const { rows } = await t.ownerPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      owned: number;
    }>(
      `SELECT r.rolsuper, r.rolbypassrls,
              (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owned
       FROM pg_roles r WHERE r.rolname = $1`,
      [DB_APP_ROLE],
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owned: 0 });
  });

  it('le rôle propriétaire ne contourne pas la RLS (ni superutilisateur, ni BYPASSRLS)', async () => {
    const { rows } = await t.ownerPool.query<{
      role: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname AS role, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname = ANY($1) ORDER BY rolname`,
      [[DB_APP_ROLE, DB_OWNER_ROLE]],
    );
    expect(rows).toEqual([
      { role: DB_APP_ROLE, rolsuper: false, rolbypassrls: false },
      { role: DB_OWNER_ROLE, rolsuper: false, rolbypassrls: false },
    ]);
  });

  it('journal du serveur PostgreSQL sans valeurs en conflit (terse), non modifiable par l’application', async () => {
    const client = await t.appPool.connect();
    try {
      const { rows } = await client.query<{ log_error_verbosity: string }>(
        'SHOW log_error_verbosity',
      );
      expect(rows[0]?.log_error_verbosity).toBe('terse');
      await expect(client.query("SET log_error_verbosity TO 'verbose'")).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      client.release();
    }
  });

  it("le journal d'audit est en ajout seul pour le rôle applicatif", async () => {
    const { rows } = await t.ownerPool.query<{ privilege: string; granted: boolean }>(
      `SELECT p AS privilege, has_table_privilege($1, 'public.audit_logs', p) AS granted
       FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p`,
      [DB_APP_ROLE],
    );
    expect(Object.fromEntries(rows.map((r) => [r.privilege, r.granted]))).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: false,
      DELETE: false,
      TRUNCATE: false,
    });
  });

  it("toute table référençant patients est prise en compte par l'annulation d'import", async () => {
    // L'annulation d'un import supprime des patients (imports.service.ts, revert). Une nouvelle
    // table liée aux patients (rendez-vous, paiements…) doit être ajoutée à ses conditions,
    // puis à cette liste.
    const { rows } = await t.ownerPool.query<{ table: string; on_delete: string }>(`
      SELECT c.conrelid::regclass::text AS table, c.confdeltype::text AS on_delete
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.confrelid = 'public.patients'::regclass
      ORDER BY 1`);
    expect(rows).toEqual([
      { table: 'appointments', on_delete: 'r' }, // bloque : exclu de l'annulation
      { table: 'charges', on_delete: 'r' }, // bloque : exclu de l'annulation
      { table: 'patient_contacts', on_delete: 'c' }, // suppression en cascade
      { table: 'patient_medical_notes', on_delete: 'r' }, // bloque : exclu de l'annulation
      { table: 'payments', on_delete: 'r' }, // bloque : exclu de l'annulation
    ]);
  });

  it("horaires et rendez-vous sont protégés du chevauchement par des contraintes d'exclusion", async () => {
    const { rows } = await t.ownerPool.query<{ name: string }>(`
      SELECT conname AS name FROM pg_constraint WHERE contype = 'x' ORDER BY 1`);
    expect(rows.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'appointments_no_patient_overlap',
        'appointments_no_practitioner_overlap',
        'working_intervals_no_overlap',
        'working_schedules_no_overlap',
      ]),
    );
  });

  it('le rôle applicatif ne peut ni supprimer un rendez-vous ni modifier occupies_slot', async () => {
    const { rows } = await t.ownerPool.query<{ check: string; granted: boolean }>(
      `SELECT c AS check, CASE c
         WHEN 'delete' THEN has_table_privilege($1, 'public.appointments', 'DELETE')
         WHEN 'update_occupies' THEN has_column_privilege($1, 'public.appointments', 'occupies_slot', 'UPDATE')
         WHEN 'update_patient' THEN has_column_privilege($1, 'public.appointments', 'patient_id', 'UPDATE')
         WHEN 'write_statuses' THEN has_table_privilege($1, 'public.appointment_statuses', 'INSERT')
       END AS granted
       FROM unnest(ARRAY['delete', 'update_occupies', 'update_patient', 'write_statuses']) AS c`,
      [DB_APP_ROLE],
    );
    expect(rows.filter((r) => r.granted).map((r) => r.check)).toEqual([]);
  });

  it('le rôle applicatif ne peut créer aucun objet dans le schéma public', async () => {
    const { rows } = await t.ownerPool.query<{ can_create: boolean }>(
      `SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
      [DB_APP_ROLE],
    );
    expect(rows[0]?.can_create).toBe(false);
  });
});
