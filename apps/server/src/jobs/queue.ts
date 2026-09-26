import { sql } from 'drizzle-orm';
import { PgBoss, fromDrizzle, type Queue, type SendOptions } from 'pg-boss';
import type { Logger } from '../config/logger';
import type { Transaction } from '../db/client';

/**
 * File de tâches (pg-boss, stockée dans PostgreSQL, schéma `pgboss`).
 * - Installation et création des files : au déploiement, par le rôle propriétaire.
 * - Exécution : par le rôle applicatif, sans droit de modifier le schéma.
 * - Envoi : toujours dans la transaction de l'écriture métier (outbox) via `enqueue`, pour
 *   qu'une action externe ne soit jamais perdue ni déclenchée pour une écriture annulée.
 */

export const JOB_SCHEMA = 'pgboss';

export interface QueueDefinition {
  name: string;
  options?: Omit<Queue, 'name'>;
}

/** Catalogue des files, créées au déploiement. Chaque phase ajoute les siennes. */
export const QUEUES: QueueDefinition[] = [];

export function createRuntimeJobQueue(connectionString: string, logger: Logger): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: JOB_SCHEMA,
    application_name: 'dental-worker-jobs',
    max: 5,
    migrate: false,
    createSchema: false,
    supervise: true,
    schedule: true,
  });
  boss.on('error', (error) => logger.error({ err: error }, 'erreur de la file de tâches'));
  return boss;
}

/**
 * Instance utilisée uniquement pour envoyer des tâches depuis une transaction (API) : ni
 * maintenance ni planification.
 */
export function createSenderJobQueue(connectionString: string, logger: Logger): PgBoss {
  const boss = new PgBoss({
    connectionString,
    schema: JOB_SCHEMA,
    application_name: 'dental-api-jobs',
    max: 2,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
  });
  boss.on('error', (error) => logger.error({ err: error }, 'erreur de la file de tâches'));
  return boss;
}

/** Installe ou met à jour le schéma pg-boss et crée les files manquantes (rôle propriétaire). */
export async function installJobQueue(
  ownerConnectionString: string,
  queues: QueueDefinition[],
): Promise<void> {
  const boss = new PgBoss({
    connectionString: ownerConnectionString,
    schema: JOB_SCHEMA,
    application_name: 'dental-migrate-jobs',
    max: 1,
    supervise: false,
    schedule: false,
  });
  await boss.start();
  try {
    const existing = new Set((await boss.getQueues()).map((q) => q.name));
    for (const queue of queues) {
      if (!existing.has(queue.name)) await boss.createQueue(queue.name, queue.options ?? {});
    }
  } finally {
    await boss.stop({ graceful: false });
  }
}

/** Droits du rôle applicatif sur le schéma pg-boss (lecture/écriture, aucune modification DDL). */
export function jobQueueGrantStatements(appRole: string): string[] {
  const s = JOB_SCHEMA;
  return [
    `GRANT USAGE ON SCHEMA ${s} TO ${appRole}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${appRole}`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${s} TO ${appRole}`,
    `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${s} TO ${appRole}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${appRole}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT EXECUTE ON FUNCTIONS TO ${appRole}`,
  ];
}

/** Enfile une tâche dans la transaction métier en cours (outbox transactionnelle). */
export async function enqueue(
  boss: PgBoss,
  tx: Transaction,
  queue: string,
  data: object,
  options: Omit<SendOptions, 'db'> = {},
): Promise<string> {
  const id = await boss.send(queue, data, { ...options, db: fromDrizzle(tx, sql) });
  if (!id) throw new Error(`Tâche non créée dans la file ${queue}`);
  return id;
}
