import { clinicResponseSchema, updateClinicRequestSchema } from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import type { ClinicService } from '../../modules/clinic/clinic.service';
import { actorOf, requestMeta } from '../auth-plugin';

export function clinicRoutes(app: FastifyInstance, deps: { clinic: ClinicService }) {
  const { clinic } = deps;

  app.get('/api/clinic', { config: { access: { authenticated: true } } }, async (request) =>
    clinicResponseSchema.parse(await clinic.get(actorOf(request))),
  );

  app.patch(
    '/api/clinic',
    { config: { access: { permission: 'clinic.settings.manage' } } },
    async (request) => {
      const body = updateClinicRequestSchema.parse(request.body);
      return clinicResponseSchema.parse(
        await clinic.update(actorOf(request), body, requestMeta(request)),
      );
    },
  );
}
