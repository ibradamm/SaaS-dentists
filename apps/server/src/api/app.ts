import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Logger } from '../config/logger';
import { errorHandler, notFoundHandler } from './error-handler';
import { healthRoutes } from './routes/health';

export interface AppDependencies {
  logger: Logger;
  pool: pg.Pool;
  trustProxyHops: number;
}

const BODY_LIMIT_BYTES = 1024 * 1024;

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  // Typé en FastifyBaseLogger pour que l'instance utilise le type de logger par défaut de Fastify.
  const loggerInstance: FastifyBaseLogger = deps.logger;
  const app = Fastify({
    loggerInstance,
    // Identifiant de requête généré côté serveur (un identifiant fourni par le client n'est
    // pas repris : il pourrait polluer les logs). Renvoyé dans l'en-tête x-request-id.
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: BODY_LIMIT_BYTES,
    // Ne fait confiance qu'aux N premiers proxys (IP client correcte derrière Caddy).
    trustProxy: (_address: string, hop: number) => hop < deps.trustProxyHops,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(helmet);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  healthRoutes(app, { pool: deps.pool });

  return app;
}
