import type pg from 'pg';
import { DB_APP_ROLE, DB_OWNER_ROLE } from './roles';

/**
 * Invariants de sécurité d'une base déployée, vérifiés sur la base réelle (PostgreSQL de
 * l'hébergeur) à chaque déploiement, après les migrations : mêmes règles que le test
 * schema-catalog, qui ne voit que la base de test.
 *   - toute table du schéma public : RLS activée, forcée, au moins une politique ;
 *   - rôles dental_app et dental_owner : ni superutilisateur, ni BYPASSRLS ;
 *     dental_app propriétaire d'aucune table, sans droit de création dans public ;
 *   - journal du serveur sans valeurs en conflit (log_error_verbosity = terse).
 * Renvoie la liste des écarts (vide si tout est conforme).
 */
export async function checkDatabase(db: Pick<pg.ClientBase, 'query'>): Promise<string[]> {
  const problems: string[] = [];

  const tables = await db.query<{ name: string; rls: boolean; forced: boolean; policies: number }>(`
    SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           (SELECT count(*)::int FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`);
  if (tables.rows.length === 0) problems.push('aucune table dans le schéma public');
  for (const t of tables.rows) {
    if (!t.rls || !t.forced || t.policies === 0) {
      problems.push(
        `table ${t.name} : RLS ${t.rls ? '' : 'inactive '}${t.forced ? '' : 'non forcée '}${t.policies} politique(s)`,
      );
    }
  }

  const roles = await db.query<{
    name: string;
    superuser: boolean;
    bypass: boolean;
    owned: number;
    can_create: boolean;
  }>(
    `SELECT r.rolname AS name, r.rolsuper AS superuser, r.rolbypassrls AS bypass,
            (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid AND c.relkind IN ('r', 'p')) AS owned,
            has_schema_privilege(r.rolname, 'public', 'CREATE') AS can_create
     FROM pg_roles r WHERE r.rolname = ANY($1) ORDER BY r.rolname`,
    [[DB_APP_ROLE, DB_OWNER_ROLE]],
  );
  for (const role of [DB_APP_ROLE, DB_OWNER_ROLE]) {
    const r = roles.rows.find((row) => row.name === role);
    if (!r) {
      problems.push(`rôle ${role} absent`);
      continue;
    }
    if (r.superuser) problems.push(`rôle ${role} superutilisateur`);
    if (r.bypass) problems.push(`rôle ${role} avec BYPASSRLS`);
    if (role === DB_APP_ROLE && r.owned > 0) problems.push(`rôle ${role} propriétaire de tables`);
    if (role === DB_APP_ROLE && r.can_create) problems.push(`rôle ${role} peut créer dans public`);
  }

  const verbosity = await db.query<{ setting: string }>(
    `SELECT setting FROM pg_settings WHERE name = 'log_error_verbosity'`,
  );
  if (verbosity.rows[0]?.setting !== 'terse') {
    problems.push(
      `log_error_verbosity = ${verbosity.rows[0]?.setting ?? '?'} (terse attendu : régler la configuration PostgreSQL de l'hébergeur)`,
    );
  }
  return problems;
}
