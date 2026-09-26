import type { PgBoss } from 'pg-boss';
import type pg from 'pg';
import type { Logger } from '../config/logger';

export interface JobContext {
  logger: Logger;
  pool: pg.Pool;
}

/**
 * Enregistre les gestionnaires de tâches. Chaque phase ajoute les siens (synchronisation
 * Google, envoi WhatsApp, agent, rappels) ; chaque tâche métier porte un clinicId et s'exécute
 * dans withTenant. Retourne les noms des files écoutées.
 */
export function registerJobHandlers(_boss: PgBoss, _context: JobContext): Promise<string[]> {
  return Promise.resolve([]);
}
