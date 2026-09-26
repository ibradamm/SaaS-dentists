import { afterAll, describe, expect, it } from 'vitest';
import { openTestDatabase } from '../../../test/db';
import { DB_APP_ROLE } from '../roles';

/**
 * Garde-fou structurel : toute nouvelle table métier doit être isolée par cabinet. Ce test
 * échoue si une migration ajoute une table avec clinic_id sans RLS activée et forcée.
 */
describe('catalogue du schéma', () => {
  const t = openTestDatabase();
  afterAll(() => t.close());

  it('toute table portant clinic_id (et clinics) a la RLS activée, forcée et une politique', async () => {
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
        AND (c.relname = 'clinics' OR EXISTS (
          SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'clinic_id' AND NOT a.attisdropped))
      ORDER BY c.relname`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
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

  it('le rôle applicatif ne peut créer aucun objet dans le schéma public', async () => {
    const { rows } = await t.ownerPool.query<{ can_create: boolean }>(
      `SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
      [DB_APP_ROLE],
    );
    expect(rows[0]?.can_create).toBe(false);
  });
});
