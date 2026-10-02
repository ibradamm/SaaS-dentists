import type { PgBoss } from 'pg-boss';
import type pg from 'pg';
import type { Logger } from '../config/logger';
import type { Database } from '../db/client';
import { noopReporter, type ErrorReporter } from '../lib/error-reporter';
import { RETENTION_CRON, RETENTION_QUEUE, runRetention } from './retention';

export interface JobContext {
  logger: Logger;
  pool: pg.Pool;
  db: Database;
  errorReporter?: ErrorReporter;
  /** Durée de conservation des sessions terminées (SESSION_RETENTION_DAYS). */
  sessionRetentionDays?: number;
}

/**
 * Enregistre les gestionnaires de tâches asynchrones (purges, conservation des données, futures
 * intégrations externes). Chaque tâche métier porte un clinicId et s'exécute dans withTenant.
 * Retourne les noms des files écoutées.
 */
export async function registerJobHandlers(boss: PgBoss, context: JobContext): Promise<string[]> {
  const reporter = context.errorReporter ?? noopReporter;
  await boss.work(RETENTION_QUEUE, async () => {
    try {
      await runRetention({
        db: context.db,
        logger: context.logger,
        ...(context.sessionRetentionDays
          ? { sessionRetentionDays: context.sessionRetentionDays }
          : {}),
      });
    } catch (error) {
      context.logger.error({ err: error }, 'échec de la conservation des données');
      reporter.report(error, { job: RETENTION_QUEUE });
      throw error;
    }
  });
  // Planification idempotente : réenregistrée à chaque démarrage du worker.
  await boss.schedule(RETENTION_QUEUE, RETENTION_CRON, null, { tz: 'UTC' });
  return [RETENTION_QUEUE];
}
