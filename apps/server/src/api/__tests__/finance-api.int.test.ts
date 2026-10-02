import { randomBytes, randomUUID } from 'node:crypto';
import {
  chargeSchema,
  patientAccountSchema,
  paymentResultSchema,
  revenueResponseSchema,
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

describe('API paiements et revenus', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  const clock = testClock(new Date('2026-09-28T08:00:00Z'));
  const secretBox = createSecretBox(randomBytes(32));
  let app: FastifyInstance;
  let clinic: Clinic;
  let otherClinic: Clinic;
  const sessions: Partial<Record<Role, Browser>> = {};
  let counter = 0;
  let practitionerId: string;
  let typeId: string;

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

  async function newPatient(b: Browser = as('ADMIN')): Promise<string> {
    const res = await b.post('/api/patients', {
      lastName: 'Http',
      firstName: `P${(counter += 1)}`,
      contacts: [],
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }
  const newCharge = async (b: Browser, amountCents = 6000, patientId?: string) => {
    const res = await b.post('/api/charges', {
      idempotencyKey: randomUUID(),
      patientId: patientId ?? (await newPatient()),
      label: 'Consultation',
      amountCents,
    });
    expect(res.statusCode).toBe(201);
    return chargeSchema.parse(res.json());
  };
  const payment = (chargeId: string, amountCents: number, key = randomUUID()) => ({
    idempotencyKey: key,
    chargeId,
    amountCents,
    method: 'CARD',
  });

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
    otherClinic = await createTestClinic(t.ownerDb);
    app = await buildTestApp(t.appPool, { now: clock.now, secretBox });
    for (const role of ['ADMIN', 'DENTIST', 'SECRETARY'] as const) {
      sessions[role] = await signedIn(role);
    }
    practitionerId = (
      await as('ADMIN').post('/api/practitioners', { displayName: 'Dr Http', color: '#0ea5e9' })
    ).json<{ id: string }>().id;
    typeId = (
      await as('ADMIN').post('/api/appointment-types', {
        name: 'Contrôle',
        durationMinutes: 30,
        color: '#0ea5e9',
      })
    ).json<{ id: string }>().id;
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  it.each([
    ['ADMIN', 200, 200],
    ['DENTIST', 200, 200],
    ['SECRETARY', 403, 403],
  ] as const)(
    '%s : saisit actes et paiements ; annulation %i ; revenus %i',
    async (role, voidStatus, revenueStatus) => {
      const b = as(role);
      const charge = await newCharge(b, 5000);
      const paid = await b.post('/api/payments', payment(charge.id, 2000));
      expect(paid.statusCode).toBe(201);
      const { payment: p } = paymentResultSchema.parse(paid.json());
      const account = await b.get(`/api/patients/${charge.patientId}/account`);
      expect(patientAccountSchema.parse(account.json())).toMatchObject({
        dueCents: 5000,
        paidCents: 2000,
        remainingCents: 3000,
      });
      expect((await b.get('/api/receivables')).statusCode).toBe(200);
      const voided = await b.post(`/api/payments/${p.id}/void`, { reason: 'Erreur de saisie' });
      expect(voided.statusCode).toBe(voidStatus);
      expect(
        (await b.post(`/api/charges/${charge.id}/cancel`, { reason: 'Erreur de saisie' }))
          .statusCode,
      ).toBe(voidStatus === 200 ? 200 : 403);
      expect((await b.get('/api/finance/revenue?from=2026-09-01&to=2026-09-30')).statusCode).toBe(
        revenueStatus,
      );
      expect((await b.get('/api/finance/payments?from=2026-09-01&to=2026-09-30')).statusCode).toBe(
        revenueStatus,
      );
      if (role === 'SECRETARY') {
        // Refus sans effet : le paiement reste encaissé.
        const after = patientAccountSchema.parse(
          (await b.get(`/api/patients/${charge.patientId}/account`)).json(),
        );
        expect(after.charges[0]!.payments[0]!.status).toBe('RECORDED');
      }
    },
  );

  it('sans session : 401 ; sans jeton CSRF : refus', async () => {
    const anonymous = browser(app);
    expect((await anonymous.get('/api/receivables')).statusCode).toBe(401);
    const charge = await newCharge(as('SECRETARY'), 1000);
    const res = await as('SECRETARY').post('/api/payments', payment(charge.id, 100), {
      'x-csrf-token': 'faux',
    });
    expect(res.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
  });

  it('double envoi simultané de la même saisie : 201 puis 200, un seul paiement', async () => {
    const charge = await newCharge(as('SECRETARY'), 4000);
    const body = payment(charge.id, 4000);
    const responses = await Promise.all([
      as('SECRETARY').post('/api/payments', body),
      as('SECRETARY').post('/api/payments', body),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const ids = responses.map((r) => paymentResultSchema.parse(r.json()).payment.id);
    expect(ids[0]).toBe(ids[1]);
    const account = patientAccountSchema.parse(
      (await as('SECRETARY').get(`/api/patients/${charge.patientId}/account`)).json(),
    );
    expect(account.charges[0]!.payments).toHaveLength(1);
    // Même clé, montant différent : refus.
    expect(
      (await as('SECRETARY').post('/api/payments', { ...body, amountCents: 3999 })).json(),
    ).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('validation 400 (virgule, texte, négatif, clé absente), 404, 409 dépassement et acte payé', async () => {
    const b = as('SECRETARY');
    const charge = await newCharge(b, 3000);
    for (const bad of [
      { ...payment(charge.id, 0), amountCents: 12.5 },
      { ...payment(charge.id, 0), amountCents: '1250' },
      payment(charge.id, -100),
      { chargeId: charge.id, amountCents: 100, method: 'CARD' },
      { ...payment(charge.id, 100), method: 'CRYPTO' },
    ]) {
      const res = await b.post('/api/payments', bad);
      expect(res.statusCode).toBe(400);
    }
    expect((await b.post('/api/payments', payment(randomUUID(), 100))).statusCode).toBe(404);
    const over = await b.post('/api/payments', payment(charge.id, 3001));
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ error: { code: 'AMOUNT_EXCEEDS_REMAINING' } });
    await b.post('/api/payments', payment(charge.id, 3000));
    const cancel = await as('DENTIST').post(`/api/charges/${charge.id}/cancel`, {
      reason: 'Erreur de tarif',
    });
    expect(cancel.json()).toMatchObject({ error: { code: 'CHARGE_HAS_PAYMENTS' } });
    expect(
      (await as('DENTIST').post(`/api/charges/${charge.id}/cancel`, { reason: '' })).statusCode,
    ).toBe(400);
  });

  it('revenus du jour et journal, en heure du cabinet', async () => {
    const own = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
    const dentist = await signedIn('DENTIST', own);
    const patient = (
      await dentist.post('/api/patients', { lastName: 'Revenu', firstName: 'Api', contacts: [] })
    ).json<{ id: string }>().id;
    const created = await dentist.post('/api/charges', {
      idempotencyKey: randomUUID(),
      patientId: patient,
      label: 'Soin',
      amountCents: 9000,
      payment: { amountCents: 9000, method: 'CASH' },
    });
    expect(created.statusCode).toBe(201);
    const revenue = revenueResponseSchema.parse(
      (await dentist.get('/api/finance/revenue?from=2026-09-28&to=2026-09-28')).json(),
    );
    expect(revenue).toMatchObject({
      currency: 'EUR',
      totalCents: 9000,
      paymentsCount: 1,
      byMethod: [{ method: 'CASH', amountCents: 9000, count: 1 }],
      byDay: [{ date: '2026-09-28', amountCents: 9000, count: 1 }],
    });
    const journal = (
      await dentist.get('/api/finance/payments?from=2026-09-28&to=2026-09-28')
    ).json<{
      payments: { chargeLabel: string }[];
    }>();
    expect(journal.payments.map((p) => p.chargeLabel)).toEqual(['Soin']);
    expect(
      (await dentist.get('/api/finance/revenue?from=2026-09-30&to=2026-09-01')).statusCode,
    ).toBe(400);
  });

  it('« sans facturation » : secrétaire autorisée, CSRF exigé, autre cabinet 404, acte ensuite refusé', async () => {
    const patient = await newPatient();
    const appointment = await as('SECRETARY').post('/api/appointments', {
      practitionerId: practitionerId,
      patientId: patient,
      appointmentTypeId: typeId,
      start: '2026-09-21T09:00',
      allowOutsideAvailability: true,
    });
    expect(appointment.statusCode).toBe(201);
    const id = appointment.json<{ id: string }>().id;
    const url = `/api/appointments/${id}/billing`;
    expect(
      (await as('SECRETARY').post(url, { billingExempt: true }, { 'x-csrf-token': 'faux' })).json(),
    ).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    const outsider = await signedIn('ADMIN', otherClinic);
    expect((await outsider.post(url, { billingExempt: true })).statusCode).toBe(404);
    expect((await as('SECRETARY').post(url, { billingExempt: 'oui' })).statusCode).toBe(400);
    const res = await as('SECRETARY').post(url, { billingExempt: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ appointmentId: id, billingExempt: true });
    expect(
      (await as('SECRETARY').get(`/api/appointments/${id}`)).json<{ billingExempt: boolean }>()
        .billingExempt,
    ).toBe(true);
    const charge = await as('SECRETARY').post('/api/charges', {
      idempotencyKey: randomUUID(),
      patientId: patient,
      appointmentId: id,
      label: 'Contrôle',
      amountCents: 3000,
    });
    expect(charge.statusCode).toBe(409);
  });

  it('un autre cabinet ne voit ni le compte, ni les actes, ni les paiements', async () => {
    const charge = await newCharge(as('SECRETARY'), 2000);
    const outsider = await signedIn('ADMIN', otherClinic);
    expect((await outsider.get(`/api/patients/${charge.patientId}/account`)).statusCode).toBe(404);
    expect((await outsider.post('/api/payments', payment(charge.id, 100))).statusCode).toBe(404);
    expect(
      (await outsider.post(`/api/charges/${charge.id}/cancel`, { reason: 'Intrusion' })).statusCode,
    ).toBe(404);
  });
});
