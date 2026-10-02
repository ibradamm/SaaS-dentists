import {
  contactInputSchema,
  createMedicalNoteRequestSchema,
  createPatientRequestSchema,
  duplicateCandidatesResponseSchema,
  duplicateCheckRequestSchema,
  listMedicalNotesResponseSchema,
  listPatientsResponseSchema,
  patientDetailSchema,
  searchPatientsRequestSchema,
  updateContactRequestSchema,
  updatePatientRequestSchema,
  versionRequestSchema,
} from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PatientsService } from '../../modules/patients/patients.service';
import { actorOf, requestMeta } from '../auth-plugin';

const params = z.object({ id: z.uuid() });
const contactParams = z.object({ id: z.uuid(), contactId: z.uuid() });
const read = { access: { permission: 'patient.read' } } as const;
const write = { access: { permission: 'patient.write' } } as const;

export function patientsRoutes(app: FastifyInstance, deps: { patients: PatientsService }) {
  const { patients } = deps;

  // Lectures en POST : le texte cherché reste hors de l'adresse journalisée (écart E19).
  app.post('/api/patients/search', { config: read }, async (request) =>
    listPatientsResponseSchema.parse(
      await patients.list(actorOf(request), searchPatientsRequestSchema.parse(request.body)),
    ),
  );

  app.post('/api/patients/duplicates', { config: read }, async (request) =>
    duplicateCandidatesResponseSchema.parse({
      candidates: await patients.duplicates(
        actorOf(request),
        duplicateCheckRequestSchema.parse(request.body),
      ),
    }),
  );

  app.post('/api/patients', { config: write }, async (request, reply) => {
    const body = createPatientRequestSchema.parse(request.body);
    const created = await patients.create(actorOf(request), body, requestMeta(request));
    return reply.status(201).send(patientDetailSchema.parse(created));
  });

  app.get('/api/patients/:id', { config: read }, async (request) =>
    patientDetailSchema.parse(
      await patients.get(actorOf(request), params.parse(request.params).id),
    ),
  );

  app.patch('/api/patients/:id', { config: write }, async (request) => {
    const { id } = params.parse(request.params);
    const body = updatePatientRequestSchema.parse(request.body);
    return patientDetailSchema.parse(
      await patients.update(actorOf(request), id, body, requestMeta(request)),
    );
  });

  app.post('/api/patients/:id/archive', { config: write }, async (request) => {
    const { id } = params.parse(request.params);
    const { version } = versionRequestSchema.parse(request.body);
    return patientDetailSchema.parse(
      await patients.archive(actorOf(request), id, version, requestMeta(request)),
    );
  });

  app.post('/api/patients/:id/restore', { config: write }, async (request) => {
    const { id } = params.parse(request.params);
    const { version } = versionRequestSchema.parse(request.body);
    return patientDetailSchema.parse(
      await patients.restore(actorOf(request), id, version, requestMeta(request)),
    );
  });

  app.post('/api/patients/:id/contacts', { config: write }, async (request, reply) => {
    const { id } = params.parse(request.params);
    const body = contactInputSchema.parse(request.body);
    const updated = await patients.addContact(actorOf(request), id, body, requestMeta(request));
    return reply.status(201).send(patientDetailSchema.parse(updated));
  });

  app.patch('/api/patients/:id/contacts/:contactId', { config: write }, async (request) => {
    const { id, contactId } = contactParams.parse(request.params);
    const body = updateContactRequestSchema.parse(request.body);
    return patientDetailSchema.parse(
      await patients.updateContact(actorOf(request), id, contactId, body, requestMeta(request)),
    );
  });

  app.delete('/api/patients/:id/contacts/:contactId', { config: write }, async (request) => {
    const { id, contactId } = contactParams.parse(request.params);
    return patientDetailSchema.parse(
      await patients.removeContact(actorOf(request), id, contactId, requestMeta(request)),
    );
  });

  app.get(
    '/api/patients/:id/medical-notes',
    { config: { access: { permission: 'patient.medical.read' } } },
    async (request) =>
      listMedicalNotesResponseSchema.parse({
        notes: await patients.listMedicalNotes(
          actorOf(request),
          params.parse(request.params).id,
          requestMeta(request),
        ),
      }),
  );

  app.post(
    '/api/patients/:id/medical-notes',
    { config: { access: { permission: 'patient.medical.write' } } },
    async (request, reply) => {
      const { id } = params.parse(request.params);
      const { content } = createMedicalNoteRequestSchema.parse(request.body);
      await patients.addMedicalNote(actorOf(request), id, content, requestMeta(request));
      return reply.status(204).send();
    },
  );
}
