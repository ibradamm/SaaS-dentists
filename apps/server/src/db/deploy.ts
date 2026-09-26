import pg from 'pg';
import {
  installJobQueue,
  jobQueueGrantStatements,
  QUEUES,
  type QueueDefinition,
} from '../jobs/queue';
import { loadMigrations, runMigrations, type MigrationResult } from './migrator';
import { DB_APP_ROLE } from './roles';

// Verrou de session couvrant tout le déploiement (distinct de celui des migrations).
const DEPLOY_LOCK_KEY = 72_615_002;

/**
 * Étape de déploiement de la base, exécutée avec le rôle propriétaire :
 * 1. migrations SQL de l'application ;
 * 2. schéma pg-boss et files déclarées ;
 * 3. droits du rôle applicatif sur pg-boss.
 *
 * Deux déploiements simultanés (deux instances qui démarrent) sont sérialisés de bout en bout :
 * sans ce verrou, leurs GRANT concurrents échouent (« tuple concurrently updated »).
 */
export async function deployDatabase(
  ownerConnectionString: string,
  options: { queues?: QueueDefinition[]; log?: (message: string) => void } = {},
): Promise<MigrationResult> {
  const client = new pg.Client({
    connectionString: ownerConnectionString,
    application_name: 'dental-migrate',
  });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [DEPLOY_LOCK_KEY]);
    const result = await runMigrations(client, await loadMigrations(), options.log);
    await installJobQueue(ownerConnectionString, options.queues ?? QUEUES);
    for (const statement of jobQueueGrantStatements(DB_APP_ROLE)) {
      await client.query(statement);
    }
    return result;
  } finally {
    // La fermeture de la session libère aussi le verrou ; le déverrouillage explicite le rend
    // disponible sans attendre la fin de la connexion.
    await client.query('SELECT pg_advisory_unlock($1)', [DEPLOY_LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}
