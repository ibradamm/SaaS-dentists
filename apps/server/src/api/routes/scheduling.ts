import {
  appointmentTypeSchema,
  blockWriteResponseSchema,
  setScheduleResponseSchema,
  availabilityResponseSchema,
  createAppointmentTypeRequestSchema,
  createBlockRequestSchema,
  createPractitionerRequestSchema,
  listAppointmentTypesResponseSchema,
  listBlocksResponseSchema,
  listPractitionersQuerySchema,
  listPractitionersResponseSchema,
  listSchedulesResponseSchema,
  practitionerSchema,
  replaceBlockRequestSchema,
  setScheduleRequestSchema,
  updateAppointmentTypeRequestSchema,
  updatePractitionerRequestSchema,
  versionBodySchema,
} from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SCHEDULE_PERMISSIONS } from '../../modules/scheduling/access';
import type { PractitionersService } from '../../modules/scheduling/practitioners.service';
import type { SchedulesService } from '../../modules/scheduling/schedules.service';
import { actorOf, requestMeta } from '../auth-plugin';

const params = z.object({ id: z.uuid() });
const periodParams = z.object({ id: z.uuid(), periodId: z.uuid() });
const versionQuery = z.object({ version: z.coerce.number().int().positive() });

const read = { access: { permission: 'appointment.read' } } as const;
const manageClinic = { access: { permission: 'clinic.settings.manage' } } as const;
// Son propre agenda (dentiste) ou tout agenda (administrateur, secrétariat) : le service
// vérifie la portée exacte (docs/adr/0006).
const manageSchedule = { access: { anyPermission: SCHEDULE_PERMISSIONS } } as const;

export function schedulingRoutes(
  app: FastifyInstance,
  deps: { practitioners: PractitionersService; schedules: SchedulesService },
) {
  const { practitioners, schedules } = deps;

  // --- Praticiens ------------------------------------------------------------------------

  app.get('/api/practitioners', { config: read }, async (request) =>
    listPractitionersResponseSchema.parse({
      practitioners: await practitioners.listPractitioners(
        actorOf(request),
        listPractitionersQuerySchema.parse(request.query),
      ),
    }),
  );

  app.post('/api/practitioners', { config: manageClinic }, async (request, reply) => {
    const body = createPractitionerRequestSchema.parse(request.body);
    const created = await practitioners.createPractitioner(
      actorOf(request),
      body,
      requestMeta(request),
    );
    return reply.status(201).send(practitionerSchema.parse(created));
  });

  app.patch('/api/practitioners/:id', { config: manageClinic }, async (request) => {
    const { id } = params.parse(request.params);
    const body = updatePractitionerRequestSchema.parse(request.body);
    return practitionerSchema.parse(
      await practitioners.updatePractitioner(actorOf(request), id, body, requestMeta(request)),
    );
  });

  app.post('/api/practitioners/:id/archive', { config: manageClinic }, async (request) => {
    const { id } = params.parse(request.params);
    const { version } = versionBodySchema.parse(request.body);
    return practitionerSchema.parse(
      await practitioners.archivePractitioner(actorOf(request), id, version, requestMeta(request)),
    );
  });

  app.post('/api/practitioners/:id/restore', { config: manageClinic }, async (request) => {
    const { id } = params.parse(request.params);
    const { version } = versionBodySchema.parse(request.body);
    return practitionerSchema.parse(
      await practitioners.restorePractitioner(actorOf(request), id, version, requestMeta(request)),
    );
  });

  // --- Types de rendez-vous ----------------------------------------------------------------

  app.get('/api/appointment-types', { config: read }, async (request) =>
    listAppointmentTypesResponseSchema.parse({
      appointmentTypes: await practitioners.listTypes(
        actorOf(request),
        listPractitionersQuerySchema.parse(request.query),
      ),
    }),
  );

  app.post('/api/appointment-types', { config: manageClinic }, async (request, reply) => {
    const body = createAppointmentTypeRequestSchema.parse(request.body);
    const created = await practitioners.createType(actorOf(request), body, requestMeta(request));
    return reply.status(201).send(appointmentTypeSchema.parse(created));
  });

  app.patch('/api/appointment-types/:id', { config: manageClinic }, async (request) => {
    const { id } = params.parse(request.params);
    const body = updateAppointmentTypeRequestSchema.parse(request.body);
    return appointmentTypeSchema.parse(
      await practitioners.updateType(actorOf(request), id, body, requestMeta(request)),
    );
  });

  app.post('/api/appointment-types/:id/archive', { config: manageClinic }, async (request) => {
    const { id } = params.parse(request.params);
    const { version } = versionBodySchema.parse(request.body);
    return appointmentTypeSchema.parse(
      await practitioners.archiveType(actorOf(request), id, version, requestMeta(request)),
    );
  });

  app.post('/api/appointment-types/:id/restore', { config: manageClinic }, async (request) => {
    const { id } = params.parse(request.params);
    const { version } = versionBodySchema.parse(request.body);
    return appointmentTypeSchema.parse(
      await practitioners.restoreType(actorOf(request), id, version, requestMeta(request)),
    );
  });

  // --- Horaires de travail -----------------------------------------------------------------

  app.get('/api/practitioners/:id/schedules', { config: read }, async (request) =>
    listSchedulesResponseSchema.parse({
      periods: await schedules.listSchedules(actorOf(request), params.parse(request.params).id),
    }),
  );

  app.put('/api/practitioners/:id/schedules', { config: manageSchedule }, async (request) => {
    const { id } = params.parse(request.params);
    const body = setScheduleRequestSchema.parse(request.body);
    return setScheduleResponseSchema.parse(
      await schedules.setSchedule(actorOf(request), id, body, requestMeta(request)),
    );
  });

  app.delete(
    '/api/practitioners/:id/schedules/:periodId',
    { config: manageSchedule },
    async (request) => {
      const { id, periodId } = periodParams.parse(request.params);
      const { version } = versionQuery.parse(request.query);
      return setScheduleResponseSchema.parse(
        await schedules.deletePeriod(actorOf(request), id, periodId, version, requestMeta(request)),
      );
    },
  );

  // --- Absences, congés et blocages --------------------------------------------------------

  app.get('/api/availability-blocks', { config: read }, async (request) =>
    listBlocksResponseSchema.parse({
      blocks: await schedules.listBlocks(
        actorOf(request),
        request.query as Record<string, unknown>,
      ),
    }),
  );

  app.post('/api/availability-blocks', { config: manageSchedule }, async (request, reply) => {
    const body = createBlockRequestSchema.parse(request.body);
    const created = await schedules.createBlock(actorOf(request), body, requestMeta(request));
    return reply.status(201).send(blockWriteResponseSchema.parse(created));
  });

  app.put('/api/availability-blocks/:id', { config: manageSchedule }, async (request) => {
    const { id } = params.parse(request.params);
    const body = replaceBlockRequestSchema.parse(request.body);
    return blockWriteResponseSchema.parse(
      await schedules.replaceBlock(actorOf(request), id, body, requestMeta(request)),
    );
  });

  app.delete('/api/availability-blocks/:id', { config: manageSchedule }, async (request, reply) => {
    const { id } = params.parse(request.params);
    const { version } = versionQuery.parse(request.query);
    await schedules.deleteBlock(actorOf(request), id, version, requestMeta(request));
    return reply.status(204).send();
  });

  // --- Disponibilités ----------------------------------------------------------------------

  app.get('/api/availability', { config: read }, async (request) =>
    availabilityResponseSchema.parse(
      await schedules.availability(actorOf(request), request.query as Record<string, unknown>),
    ),
  );
}
