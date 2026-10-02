import { dashboardResponseSchema, type Permission } from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import type { StatsService } from '../../modules/stats/stats.service';
import { actorOf } from '../auth-plugin';

const anyDashboardPermission: readonly Permission[] = [
  'appointment.read',
  'patient.read',
  'payment.read',
  'finance.reports.read',
];

/**
 * Tableau de bord (docs/adr/0010) : une seule lecture, dont les sections dépendent des
 * permissions du compte. Le service vérifie chaque section.
 */
export function statsRoutes(app: FastifyInstance, deps: { stats: StatsService }) {
  app.get(
    '/api/dashboard',
    { config: { access: { anyPermission: anyDashboardPermission } } },
    async (request) =>
      dashboardResponseSchema.parse(
        await deps.stats.dashboard(actorOf(request), request.query as Record<string, unknown>),
      ),
  );
}
