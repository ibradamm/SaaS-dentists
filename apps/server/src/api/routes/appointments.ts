import {
  appointmentSchema,
  changeAppointmentStatusRequestSchema,
  createAppointmentRequestSchema,
  listAppointmentsResponseSchema,
  slotsResponseSchema,
  updateAppointmentRequestSchema,
} from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppointmentsService } from '../../modules/appointments/appointments.service';
import { actorOf, requestMeta } from '../auth-plugin';

const params = z.object({ id: z.uuid() });
const read = { access: { permission: 'appointment.read' } } as const;
const write = { access: { permission: 'appointment.write' } } as const;

export function appointmentsRoutes(
  app: FastifyInstance,
  deps: { appointments: AppointmentsService },
) {
  const { appointments } = deps;

  app.get('/api/appointments', { config: read }, async (request) =>
    listAppointmentsResponseSchema.parse({
      appointments: await appointments.list(
        actorOf(request),
        request.query as Record<string, unknown>,
      ),
    }),
  );

  app.get('/api/appointments/:id', { config: read }, async (request) =>
    appointmentSchema.parse(
      await appointments.get(actorOf(request), params.parse(request.params).id),
    ),
  );

  app.post('/api/appointments', { config: write }, async (request, reply) => {
    const body = createAppointmentRequestSchema.parse(request.body);
    const { appointment, replayed } = await appointments.createOrReplay(
      actorOf(request),
      body,
      requestMeta(request),
    );
    // Saisie rejouée (même clé d'idempotence) : 200 avec le rendez-vous déjà créé.
    return reply.status(replayed ? 200 : 201).send(appointmentSchema.parse(appointment));
  });

  app.patch('/api/appointments/:id', { config: write }, async (request) => {
    const { id } = params.parse(request.params);
    const body = updateAppointmentRequestSchema.parse(request.body);
    return appointmentSchema.parse(
      await appointments.update(actorOf(request), id, body, requestMeta(request)),
    );
  });

  app.post('/api/appointments/:id/status', { config: write }, async (request) => {
    const { id } = params.parse(request.params);
    const body = changeAppointmentStatusRequestSchema.parse(request.body);
    return appointmentSchema.parse(
      await appointments.changeStatus(actorOf(request), id, body, requestMeta(request)),
    );
  });

  app.get('/api/patients/:id/appointments', { config: read }, async (request) =>
    listAppointmentsResponseSchema.parse({
      appointments: await appointments.forPatient(
        actorOf(request),
        params.parse(request.params).id,
      ),
    }),
  );

  app.get('/api/availability/slots', { config: read }, async (request) =>
    slotsResponseSchema.parse(
      await appointments.slots(actorOf(request), request.query as Record<string, unknown>),
    ),
  );
}
