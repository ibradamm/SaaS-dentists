import { auditActorsResponseSchema, auditLogResponseSchema } from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import type { AuditLogService } from '../../modules/audit/audit-log.service';
import { actorOf } from '../auth-plugin';

const config = { access: { permission: 'audit.read' } } as const;

/** Journal d'audit consultable (docs/adr/0011) : lecture seule, jamais de modification. */
export function auditRoutes(app: FastifyInstance, deps: { auditLog: AuditLogService }) {
  app.get('/api/audit-logs', { config }, async (request) =>
    auditLogResponseSchema.parse(
      await deps.auditLog.list(actorOf(request), request.query as Record<string, unknown>),
    ),
  );

  app.get('/api/audit-logs/actors', { config }, async (request) =>
    auditActorsResponseSchema.parse(await deps.auditLog.actors(actorOf(request))),
  );
}
