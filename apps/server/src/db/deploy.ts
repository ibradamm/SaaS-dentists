import pg from 'pg';
import {
  installJobQueue,
  jobQueueGrantStatements,
  QUEUES,
  type QueueDefinition,
} from '../jobs/queue';
import { loadMigrations, runMigrations, type MigrationResult } from './migrator';
import { DB_APP_ROLE } from './roles';

/**
 * Étape de déploiement de la base, exécutée avec le rôle propriétaire :
 * 1. migrations SQL de l'application ;
 * 2. schéma pg-boss et files déclarées ;
 * 3. droits du rôle applicatif sur pg-boss.
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
    const result = await runMigrations(client, await loadMigrations(), options.log);
    await installJobQueue(ownerConnectionString, options.queues ?? QUEUES);
    for (const statement of jobQueueGrantStatements(DB_APP_ROLE)) {
      await client.query(statement);
    }
    return result;
  } finally {
    await client.end();
  }
}
