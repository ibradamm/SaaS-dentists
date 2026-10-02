import { randomBytes } from 'node:crypto';
import {
  availabilityBlockSchema,
  availabilityResponseSchema,
  listSchedulesResponseSchema,
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

describe('API praticiens, horaires et disponibilités', () => {
  const t = openTestDatabase();
  // Samedi 26 septembre 2026 à Paris.
  const clock = testClock(new Date('2026-09-26T10:00:00Z'));
  const secretBox = createSecretBox(randomBytes(32));
  let app: FastifyInstance;
  let clinic: Clinic;
  let admin: Browser;

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    app = await buildTestApp(t.appPool, { now: clock.now, secretBox });
    admin = (await signedIn('ADMIN')).b;
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  async function signedIn(role: Role): Promise<{ b: Browser; userId: string }> {
    const user = await createUser(t.ownerDb, clinic.id, role);
    const secret =
      role === 'SECRETARY' ? null : await enableMfa(t.ownerDb, clinic.id, user.id, secretBox);
    const b = browser(app);
    await b.login(user.email, user.password);
    if (secret) {
      clock.advanceSeconds(30);
      await b.post('/api/auth/mfa/verify', { code: await totpAt(secret, clock.epochSeconds()) });
    }
    return { b, userId: user.id };
  }

  async function createPractitioner(displayName: string, userId: string | null = null) {
    const res = await admin.post('/api/practitioners', { displayName, color: '#0ea5e9', userId });
    expect(res.statusCode).toBe(201);
    return practitionerSchema.parse(res.json());
  }

  const weekSchedule = {
    validFrom: '2026-09-28',
    basePeriod: null,
    intervals: [
      { weekday: 1, start: '09:00', end: '12:00' },
      { weekday: 1, start: '14:00', end: '18:00' },
    ],
  };
  const closure = {
    practitionerId: null,
    kind: 'ABSENCE',
    allDay: true,
    startDate: '2026-12-25',
    endDate: '2026-12-25',
    label: 'Noël',
  };

  describe('permissions HTTP par rôle', () => {
    const expected: Record<Role, { manageClinic: boolean; anySchedule: boolean }> = {
      ADMIN: { manageClinic: true, anySchedule: true },
      DENTIST: { manageClinic: false, anySchedule: false },
      SECRETARY: { manageClinic: false, anySchedule: true },
    };

    it.each(['ADMIN', 'DENTIST', 'SECRETARY'] as const)('%s', async (role) => {
      const { b } = await signedIn(role);
      const someone = await createPractitioner(`Dr ${role}`);
      // Lecture : tout le personnel.
      for (const url of [
        '/api/practitioners',
        '/api/appointment-types',
        `/api/practitioners/${someone.id}/schedules`,
        '/api/availability-blocks?from=2026-09-28&to=2026-10-04',
        '/api/availability?from=2026-09-28&to=2026-10-04',
      ]) {
        expect({ url, status: (await b.get(url)).statusCode }).toEqual({ url, status: 200 });
      }
      const exp = expected[role];
      const statuses = {
        createPractitioner: (
          await b.post('/api/practitioners', { displayName: 'Nouveau', color: '#123456' })
        ).statusCode,
        createType: (
          await b.post('/api/appointment-types', {
            name: `Soin ${role}`,
            durationMinutes: 30,
            color: '#10b981',
          })
        ).statusCode,
        otherSchedule: (await b.put(`/api/practitioners/${someone.id}/schedules`, weekSchedule))
          .statusCode,
        clinicClosure: (await b.post('/api/availability-blocks', { ...closure, label: role }))
          .statusCode,
      };
      expect(statuses).toEqual({
        createPractitioner: exp.manageClinic ? 201 : 403,
        createType: exp.manageClinic ? 201 : 403,
        otherSchedule: exp.anySchedule ? 200 : 403,
        clinicClosure: exp.anySchedule ? 201 : 403,
      });
    });
  });

  it('le dentiste gère son propre agenda de bout en bout', async () => {
    const { b, userId } = await signedIn('DENTIST');
    const own = await createPractitioner('Dr Soi', userId);
    const schedule = await b.put(`/api/practitioners/${own.id}/schedules`, weekSchedule);
    expect(schedule.statusCode).toBe(200);
    const [period] = listSchedulesResponseSchema.parse(schedule.json()).periods;
    expect(period).toMatchObject({ validFrom: '2026-09-28', validTo: null });

    const created = await b.post('/api/availability-blocks', {
      practitionerId: own.id,
      kind: 'BLOCK',
      allDay: false,
      start: '2026-09-28T10:00',
      end: '2026-09-28T11:00',
    });
    expect(created.statusCode).toBe(201);
    const block = availabilityBlockSchema.parse(created.json<{ block: unknown }>().block);

    const availability = availabilityResponseSchema.parse(
      (
        await b.get(`/api/availability?from=2026-09-28&to=2026-09-28&practitionerId=${own.id}`)
      ).json(),
    );
    expect(availability.timezone).toBe('Europe/Paris');
    expect(availability.practitioners[0]!.available).toEqual([
      { start: '2026-09-28T07:00:00.000Z', end: '2026-09-28T08:00:00.000Z' },
      { start: '2026-09-28T09:00:00.000Z', end: '2026-09-28T10:00:00.000Z' },
      { start: '2026-09-28T12:00:00.000Z', end: '2026-09-28T16:00:00.000Z' },
    ]);

    const moved = await b.put(`/api/availability-blocks/${block.id}`, {
      version: block.version,
      kind: 'BLOCK',
      allDay: false,
      start: '2026-09-28T11:00',
      end: '2026-09-28T12:00',
    });
    expect(moved.statusCode).toBe(200);
    expect((await b.delete(`/api/availability-blocks/${block.id}`)).statusCode).toBe(400);
    expect((await b.delete(`/api/availability-blocks/${block.id}?version=1`)).statusCode).toBe(409);
    expect((await b.delete(`/api/availability-blocks/${block.id}?version=2`)).statusCode).toBe(204);
  });

  it('erreurs : 400 grille horaire, 404 praticien inconnu, 409 version, 403 sans jeton CSRF', async () => {
    const p = await createPractitioner('Dr Erreurs');
    const offGrid = await admin.put(`/api/practitioners/${p.id}/schedules`, {
      ...weekSchedule,
      intervals: [{ weekday: 1, start: '09:07', end: '12:00' }],
    });
    expect(offGrid.statusCode).toBe(400);
    const unknown = await admin.put(
      '/api/practitioners/01a0de00-0000-7000-8000-00000000ffff/schedules',
      weekSchedule,
    );
    expect(unknown.statusCode).toBe(404);
    const stale = await admin.patch(`/api/practitioners/${p.id}`, {
      version: 9,
      displayName: 'Autre',
    });
    expect(stale.statusCode).toBe(409);
    const withoutCsrf = await admin.put(`/api/practitioners/${p.id}/schedules`, weekSchedule, {
      'x-csrf-token': 'faux',
    });
    expect(withoutCsrf.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
  });

  it('profil du cabinet : coordonnées modifiables par l’administrateur seulement', async () => {
    const { b } = await signedIn('SECRETARY');
    expect((await b.patch('/api/clinic', { city: 'Lyon' })).statusCode).toBe(403);
    const res = await admin.patch('/api/clinic', { city: 'Lyon', phone: '04 78 00 00 00' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ city: 'Lyon', phone: '+33478000000' });
    expect((await b.get('/api/clinic')).json()).toMatchObject({ city: 'Lyon' });
  });
});
