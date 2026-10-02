import type pg from 'pg';

export class PrivilegedRoleError extends Error {
  constructor(role: string, reasons: string[]) {
    super(
      `Le rôle PostgreSQL « ${role} » est trop privilégié pour l'application (${reasons.join(', ')}). ` +
        'Utiliser le rôle dental_app : la Row-Level Security ne protège pas un rôle privilégié.',
    );
    this.name = 'PrivilegedRoleError';
  }
}

/**
 * Refuse de démarrer si l'application se connecte avec un rôle qui contournerait la RLS :
 * superutilisateur, attribut BYPASSRLS, ou propriétaire d'une table (cas d'une mauvaise
 * DATABASE_URL pointant vers le rôle de migration).
 */
export async function assertLeastPrivilege(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{
    role: string;
    is_superuser: boolean;
    bypass_rls: boolean;
    owns_tables: boolean;
  }>(`
    SELECT current_user AS role,
           r.rolsuper AS is_superuser,
           r.rolbypassrls AS bypass_rls,
           EXISTS (
             SELECT 1 FROM pg_class c
             WHERE c.relowner = r.oid AND c.relkind IN ('r', 'p')
           ) AS owns_tables
    FROM pg_roles r WHERE r.rolname = current_user`);
  const row = rows[0];
  if (!row) throw new PrivilegedRoleError('inconnu', ['rôle introuvable']);
  const reasons = [
    row.is_superuser && 'superutilisateur',
    row.bypass_rls && 'BYPASSRLS',
    row.owns_tables && 'propriétaire de tables',
  ].filter((r): r is string => typeof r === 'string');
  if (reasons.length > 0) throw new PrivilegedRoleError(row.role, reasons);
}
