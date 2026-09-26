import type { LivenessResponse, ReadinessResponse } from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

const READINESS_TIMEOUT_MS = 2_000;

async function checkDatabase(pool: pg.Pool): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('délai dépassé')), READINESS_TIMEOUT_MS);
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * - /health/live  : le processus répond (ne dépend d'aucun service externe).
 * - /health/ready : l'API peut servir des requêtes (base de données joignable).
 */
export function healthRoutes(app: FastifyInstance, options: { pool: pg.Pool }) {
  app.get('/health/live', { logLevel: 'warn' }, () => {
    const body: LivenessResponse = { status: 'ok' };
    return body;
  });

  app.get('/health/ready', { logLevel: 'warn' }, async (request, reply) => {
    try {
      await checkDatabase(options.pool);
      const body: ReadinessResponse = { status: 'ok', checks: { database: 'ok' } };
      return body;
    } catch (error) {
      request.log.error({ err: error }, 'base de données indisponible');
      const body: ReadinessResponse = { status: 'error', checks: { database: 'error' } };
      return reply.status(503).send(body);
    }
  });
}
