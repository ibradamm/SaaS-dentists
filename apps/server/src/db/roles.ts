/**
 * Rôles PostgreSQL. Les noms sont fixes car les migrations y font référence (GRANT).
 * - DB_OWNER_ROLE : propriétaire des tables, exécute les migrations. Jamais utilisé par l'API.
 * - DB_APP_ROLE   : rôle d'exécution de l'API et du worker. Ni superutilisateur, ni BYPASSRLS,
 *                   ni propriétaire d'aucune table : la Row-Level Security s'applique toujours.
 */
export const DB_OWNER_ROLE = 'dental_owner';
export const DB_APP_ROLE = 'dental_app';
