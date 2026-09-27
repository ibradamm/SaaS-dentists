import { randomBytes, randomUUID } from 'node:crypto';
import { dashboardResponseSchema, type Role } from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, buildTestApp } from '../../../test/app';
import { createUser, enableMfa, testClock, totpAt } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import type { Clinic } from '../../db/schema';
import { createSecretBox } from '../../lib/secret-box';

type Browser = ReturnType<typeof browser>;

describe('API tableau de bord', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  // Lundi 28 septembre 2026, 10 h à Paris.
  const clock = testClock(new Date('2026-09-28T08:00:00Z'));
  const secretBox = createSecretBox(randomBytes(32));
  let app: FastifyInstance;
  let clinic: Clinic;
  const sessions: Partial<Record<Role, Browser>> = {};

  async function signedIn(role: Role, c: Clinic = clinic): Promise<Browser> {
    const user = await createUser(t.ownerDb, c.id, role);
    const secret =
      role === 'SECRETARY' ? null : await enableMfa(t.ownerDb, c.id, user.id, secretBox);
    const b = browser(app);
    await b.login(user.email, user.password);
    if (secret) {
      clock.advanceSeconds(30);
      await b.post('/api/auth/mfa/verify', { code: await totpAt(secret, clock.epochSeconds()) });
    }
    return b;
  }
  const as = (role: Role) => sessions[role]!;
  const today = '/api/dashboard?from=2026-09-28&to=2026-09-28';

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
    app = await buildTestApp(t.appPool, { now: clock.now, secretBox });
    for (const role of ['ADMIN', 'DENTIST', 'SECRETARY'] as const) {
      sessions[role] = await signedIn(role);
    }
    // Un acte payé aujourd'hui, un autre à moitié : encaissé 90 €, restant dû 30 €.
    const patient = (
      await as('SECRETARY').post('/api/patients', {
        lastName: 'Tableau',
        firstName: 'Bord',
        contacts: [],
      })
    ).json<{ id: string }>().id;
    for (const [amountCents, paid] of [
      [6000, 6000],
      [6000, 3000],
    ] as const) {
      const res = await as('SECRETARY').post('/api/charges', {
        idempotencyKey: randomUUID(),
        patientId: patient,
        label: 'Soin',
        amountCents,
        payment: { amountCents: paid, method: 'CARD' },
      });
      expect(res.statusCode).toBe(201);
    }
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  it.each([
    ['ADMIN', true],
    ['DENTIST', true],
    ['SECRETARY', false],
  ] as const)('%s : sections selon les permissions (revenus : %s)', async (role, revenue) => {
    const res = await as(role).get(today);
    expect(res.statusCode).toBe(200);
    const body = dashboardResponseSchema.parse(res.json());
    expect(body.activity).toBeDefined();
    // La date de création d'une fiche vient de l'horloge de la base, pas de l'horloge simulée :
    // les nouveaux patients sont vérifiés par le test du service, à dates explicites.
    expect(body.patients).toMatchObject({ active: 1 });
    expect(body.receivables).toEqual({ totalRemainingCents: 3000, patients: 1 });
    expect(body.unbilled).toEqual({ count: 0, items: [] });
    // Section absente de la réponse elle-même, pas masquée par l'interface.
    expect('revenue' in res.json<object>()).toBe(revenue);
    if (revenue) expect(body.revenue).toMatchObject({ totalCents: 9000, count: 2 });
  });

  it('sans session : 401', async () => {
    expect((await browser(app).get(today)).statusCode).toBe(401);
  });

  it('période ou praticien invalides : 400 ; praticien inconnu : 404', async () => {
    const b = as('DENTIST');
    for (const query of [
      'from=2026-09-30&to=2026-09-01',
      'from=2025-01-01&to=2026-01-02',
      'from=2026-02-30&to=2026-03-01',
      'from=2026-09-01',
      'from=2026-09-01&to=2026-09-30&practitionerId=pas-un-uuid',
    ]) {
      expect((await b.get(`/api/dashboard?${query}`)).statusCode).toBe(400);
    }
    expect(
      (await b.get(`/api/dashboard?from=2026-09-01&to=2026-09-30&practitionerId=${randomUUID()}`))
        .statusCode,
    ).toBe(404);
  });

  it('un autre cabinet ne voit rien de celui-ci', async () => {
    const outsider = await signedIn('ADMIN', await createTestClinic(t.ownerDb));
    const body = dashboardResponseSchema.parse((await outsider.get(today)).json());
    expect(body.patients).toEqual({ active: 0, new: 0, previousNew: 0 });
    expect(body.receivables).toEqual({ totalRemainingCents: 0, patients: 0 });
    expect(body.revenue).toMatchObject({ totalCents: 0, count: 0 });
  });
});
