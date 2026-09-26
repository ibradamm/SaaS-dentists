import { randomBytes } from 'node:crypto';
import {
  appointmentSchema,
  listAppointmentsResponseSchema,
  practitionerSchema,
  type Role,
} from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, buildTestApp } from '../../../test/app';
import { createUser, enableMfa, testClock, totpAt } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import type { Clinic } from '../../db/schema';
import { createSecretBox } from '../../lib/secret-box';

type Browser = ReturnType<typeof browser>;

describe('API rendez-vous', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  // Lundi 28 septembre 2026, 8 h à Paris.
  const clock = testClock(new Date('2026-09-28T06:00:00Z'));
  const secretBox = createSecretBox(randomBytes(32));
  let app: FastifyInstance;
  let clinic: Clinic;
  let admin: Browser;
  let practitionerId: string;
  let typeId: string;
  let patientCount = 0;

  async function signedIn(role: Role): Promise<Browser> {
    const user = await createUser(t.ownerDb, clinic.id, role);
    const secret =
      role === 'SECRETARY' ? null : await enableMfa(t.ownerDb, clinic.id, user.id, secretBox);
    const b = browser(app);
    await b.login(user.email, user.password);
    if (secret) {
      clock.advanceSeconds(30);
      await b.post('/api/auth/mfa/verify', { code: await totpAt(secret, clock.epochSeconds()) });
    }
    return b;
  }

  async function newPatient(b: Browser = admin): Promise<string> {
    const res = await b.post('/api/patients', {
      lastName: 'Rdv',
      firstName: `P${(patientCount += 1)}`,
      contacts: [],
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  const booking = (patientId: string, start: string, extra: Record<string, unknown> = {}) => ({
    practitionerId,
    patientId,
    appointmentTypeId: typeId,
    start,
    ...extra,
  });

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    app = await buildTestApp(t.appPool, { now: clock.now, secretBox });
    admin = await signedIn('ADMIN');
    const p = await admin.post('/api/practitioners', { displayName: 'Dr Api', color: '#0ea5e9' });
    practitionerId = practitionerSchema.parse(p.json()).id;
    const schedule = await admin.put(`/api/practitioners/${practitionerId}/schedules`, {
      validFrom: '2026-09-28',
      basePeriod: null,
      intervals: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
    });
    expect(schedule.statusCode).toBe(200);
    const type = await admin.post('/api/appointment-types', {
      name: 'Consultation',
      durationMinutes: 30,
      color: '#10b981',
    });
    typeId = type.json<{ id: string }>().id;
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  it.each(['ADMIN', 'DENTIST', 'SECRETARY'] as const)(
    '%s : consulte l’agenda et gère les rendez-vous',
    async (role) => {
      const b = await signedIn(role);
      const hour = { ADMIN: '09', DENTIST: '10', SECRETARY: '11' }[role];
      const created = await b.post(
        '/api/appointments',
        booking(await newPatient(b), `2026-09-29T${hour}:00`),
      );
      expect(created.statusCode).toBe(201);
      const a = appointmentSchema.parse(created.json());
      expect((await b.get('/api/appointments?from=2026-09-29&to=2026-09-29')).statusCode).toBe(200);
      expect((await b.get(`/api/appointments/${a.id}`)).statusCode).toBe(200);
      const cancelled = await b.post(`/api/appointments/${a.id}/status`, {
        version: a.version,
        status: 'CANCELLED',
      });
      expect(cancelled.json()).toMatchObject({ status: 'CANCELLED' });
    },
  );

  it('sans session : 401 ; sans jeton CSRF : refus', async () => {
    const anonymous = browser(app);
    expect(
      (await anonymous.get('/api/appointments?from=2026-09-29&to=2026-09-29')).statusCode,
    ).toBe(401);
    const res = await admin.post(
      '/api/appointments',
      booking(await newPatient(), '2026-09-29T14:00'),
      {
        'x-csrf-token': 'faux',
      },
    );
    expect(res.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
  });

  it('hors horaires : 409 avec le code de confirmation, puis 201 une fois confirmé', async () => {
    const patient = await newPatient();
    const refused = await admin.post('/api/appointments', booking(patient, '2026-09-30T19:00'));
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'AVAILABILITY_CONFIRMATION_REQUIRED' } });
    const confirmed = await admin.post(
      '/api/appointments',
      booking(patient, '2026-09-30T19:00', { allowOutsideAvailability: true }),
    );
    expect(confirmed.statusCode).toBe(201);
  });

  it('absence : 409 PRACTITIONER_ABSENT ; créneau pris : 409 SLOT_UNAVAILABLE ; conflits listés', async () => {
    const taken = await admin.post(
      '/api/appointments',
      booking(await newPatient(), '2026-10-01T09:00'),
    );
    expect(taken.statusCode).toBe(201);
    const clash = await admin.post(
      '/api/appointments',
      booking(await newPatient(), '2026-10-01T09:15'),
    );
    expect(clash.json()).toMatchObject({ error: { code: 'SLOT_UNAVAILABLE' } });
    const absence = await admin.post('/api/availability-blocks', {
      practitionerId,
      kind: 'ABSENCE',
      allDay: true,
      startDate: '2026-10-01',
      endDate: '2026-10-01',
    });
    expect(absence.statusCode).toBe(201);
    expect(absence.json<{ conflicts: { id: string }[] }>().conflicts.map((c) => c.id)).toEqual([
      appointmentSchema.parse(taken.json()).id,
    ]);
    const during = await admin.post(
      '/api/appointments',
      booking(await newPatient(), '2026-10-01T15:00', { allowOutsideAvailability: true }),
    );
    expect(during.json()).toMatchObject({ error: { code: 'PRACTITIONER_ABSENT' } });
  });

  it('deux secrétaires sur le même créneau au même instant : 201 et 409', async () => {
    const [s1, s2] = [await signedIn('SECRETARY'), await signedIn('SECRETARY')];
    const [p1, p2] = [await newPatient(), await newPatient()];
    const responses = await Promise.all([
      s1.post('/api/appointments', booking(p1, '2026-10-02T10:00')),
      s2.post('/api/appointments', booking(p2, '2026-10-02T10:00')),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  });

  it('validation 400, patient inconnu 404, transition impossible 409', async () => {
    expect(
      (await admin.post('/api/appointments', booking(await newPatient(), '2026-10-05T09:07')))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await admin.post(
          '/api/appointments',
          booking('01a0de00-0000-7000-8000-00000000ffff', '2026-10-05T09:00'),
        )
      ).statusCode,
    ).toBe(404);
    const a = appointmentSchema.parse(
      (
        await admin.post('/api/appointments', booking(await newPatient(), '2026-10-05T10:00'))
      ).json(),
    );
    const early = await admin.post(`/api/appointments/${a.id}/status`, {
      version: a.version,
      status: 'COMPLETED',
    });
    expect(early.statusCode).toBe(409);
  });

  it('historique du patient, déplacement et créneaux libres', async () => {
    const patient = await newPatient();
    const first = appointmentSchema.parse(
      (await admin.post('/api/appointments', booking(patient, '2026-10-06T09:00'))).json(),
    );
    await admin.post('/api/appointments', booking(patient, '2026-10-13T09:00'));
    const moved = await admin.patch(`/api/appointments/${first.id}`, {
      version: first.version,
      start: '2026-10-06T09:30',
    });
    expect(moved.json()).toMatchObject({ startAt: '2026-10-06T07:30:00.000Z' });
    const history = listAppointmentsResponseSchema.parse(
      (await admin.get(`/api/patients/${patient}/appointments`)).json(),
    );
    expect(history.appointments.map((a) => a.startAt)).toEqual([
      '2026-10-13T07:00:00.000Z',
      '2026-10-06T07:30:00.000Z',
    ]);
    const slots = await admin.get(
      `/api/availability/slots?practitionerId=${practitionerId}&from=2026-10-06&to=2026-10-06&durationMinutes=30`,
    );
    expect(slots.statusCode).toBe(200);
    const list = slots.json<{ timezone: string; slots: string[] }>();
    expect(list.timezone).toBe('Europe/Paris');
    expect(list.slots.slice(0, 2)).toEqual([
      '2026-10-06T07:00:00.000Z',
      '2026-10-06T08:00:00.000Z',
    ]);
  });
});
