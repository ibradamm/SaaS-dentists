import type { ApiError, ErrorCode, OverrideReason } from '@dental/shared';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { noopReporter, type ErrorReporter } from '../lib/error-reporter';
import { AppError } from '../lib/errors';

function send(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string,
  reasons?: readonly OverrideReason[],
) {
  const body: ApiError = {
    error: {
      code,
      message,
      requestId: String(reply.request.id),
      ...(reasons ? { reasons: [...reasons] } : {}),
    },
  };
  return reply.status(status).send(body);
}

/**
 * Format d'erreur unique. Aucune trace, requête SQL ou message interne n'est renvoyé au
 * client : les détails vont dans les logs, corrélés par requestId. Seules les erreurs
 * imprévues (500) sont remontées (Sentry), jamais les refus attendus (4xx).
 */
export function createErrorHandler(reporter: ErrorReporter) {
  return function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
    if (error instanceof AppError) {
      return send(reply, error.statusCode, error.code, error.message, error.reasons);
    }
    if (error instanceof ZodError || error.validation) {
      return send(reply, 400, 'VALIDATION_FAILED', 'Requête invalide');
    }
    const status = error.statusCode ?? 500;
    if (status === 429) {
      return send(reply, 429, 'RATE_LIMITED', 'Trop de requêtes, réessayer plus tard');
    }
    if (status >= 400 && status < 500) {
      request.log.info({ err: error }, 'requête refusée');
      return send(reply, status, 'BAD_REQUEST', 'Requête invalide');
    }
    request.log.error({ err: error }, 'erreur non gérée');
    reporter.report(error, { requestId: String(request.id) });
    return send(reply, 500, 'INTERNAL_ERROR', 'Erreur interne');
  };
}

export const errorHandler = createErrorHandler(noopReporter);

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return send(reply, 404, 'NOT_FOUND', 'Ressource introuvable');
}
