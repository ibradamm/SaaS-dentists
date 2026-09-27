import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser, testClock } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import { auditLogs, payments, type Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import { createSecretBox } from '../../../lib/secret-box';
import { createAppointmentsService } from '../../appointments/appointments.service';
import type { UserActor } from '../../auth/auth.types';
import { createImportsService } from '../../imports/imports.service';
import { createPatientsService } from '../../patients/patients.service';
import { createPractitionersService } from '../../scheduling/practitioners.service';
import { createFinanceService } from '../finance.service';

describe('paiements et revenus', () => {
  const t = openTestDatabase({ appPoolMax: 8 });
  // Lundi 28 septembre 2026, 10 h à Paris.
  const clock = testClock(new Date('2026-09-28T08:00:00Z'));
  const deps = { db: t.appDb, now: clock.now };
  const finance = createFinanceService(deps);
  const practitionersService = createPractitionersService(deps);
  const appointmentsService = createAppointmentsService(deps);
  const patientsService = createPatientsService({
    ...deps,
    secretBox: createSecretBox(randomBytes(32)),
  });

  let clinic: Clinic;
  let admin: UserActor;
  let dentist: UserActor;
  let secretary: UserActor;
  let otherAdmin: UserActor;
  let drA: string;
  let type: string;
  let counter = 0;

  const actor = async (c: Clinic, role: 'ADMIN' | 'DENTIST' | 'SECRETARY') =>
    actorFor((await createUser(t.ownerDb, c.id, role)).id, role, c.id);
  const newPatient = async () =>
    (
      await patientsService.create(
        secretary,
        { lastName: 'Payeur', firstName: `N${(counter += 1)}`, contacts: [] },
        META,
      )
    ).id;
  const due = (
    patientId: string,
    amountCents: number,
    extra: Record<string, unknown> = {},
    who: UserActor = secretary,
  ) =>
    finance.createCharge(
      who,
      { idempotencyKey: randomUUID(), patientId, label: 'Détartrage', amountCents, ...extra },
      META,
    );
  const pay = (chargeId: string, amountCents: number, extra: Record<string, unknown> = {}) =>
    finance.recordPayment(
      secretary,
      { idempotencyKey: randomUUID(), chargeId, amountCents, method: 'CARD', ...extra },
      META,
    );
  const auditFor = (ids: string[]) =>
    withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select({ action: auditLogs.action, changes: auditLogs.changes })
        .from(auditLogs)
        .where(inArray(auditLogs.entityId, ids))
        .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)),
    );

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
    admin = await actor(clinic, 'ADMIN');
    dentist = await actor(clinic, 'DENTIST');
    secretary = await actor(clinic, 'SECRETARY');
    otherAdmin = await actor(await createTestClinic(t.ownerDb), 'ADMIN');
    drA = (
      await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr A', color: '#0ea5e9' },
        META,
      )
    ).id;
    type = (
      await practitionersService.createType(
        admin,
        { name: 'Consultation', durationMinutes: 30, color: '#0ea5e9' },
        META,
      )
    ).id;
  });
  afterAll(() => t.close());

  describe('montants dus et paiements partiels', () => {
    it('paiements partiels jusqu’au solde : restant dû exact, états calculés, refus au-delà', async () => {
      const patient = await newPatient();
      const { charge } = await due(patient, 6000);
      expect(charge).toMatchObject({
        amountCents: 6000,
        paidCents: 0,
        remainingCents: 6000,
        paymentState: 'UNPAID',
        currency: 'EUR',
        status: 'OPEN',
      });
      const first = await pay(charge.id, 2000);
      expect(first.charge).toMatchObject({
        paidCents: 2000,
        remainingCents: 4000,
        paymentState: 'PARTIALLY_PAID',
      });
      const second = await pay(charge.id, 4000, { method: 'CASH' });
      expect(second.charge).toMatchObject({ remainingCents: 0, paymentState: 'PAID' });
      await expect(pay(charge.id, 1)).rejects.toMatchObject({
        code: 'AMOUNT_EXCEEDS_REMAINING',
        message: expect.stringContaining('0,00') as string,
      });
      expect(await finance.account(secretary, patient)).toMatchObject({
        currency: 'EUR',
        dueCents: 6000,
        paidCents: 6000,
        remainingCents: 0,
      });
    });

    it('lié à un rendez-vous : praticien repris, encaissement immédiat dans la même transaction', async () => {
      const patient = await newPatient();
      const appointment = await appointmentsService.create(
        secretary,
        {
          practitionerId: drA,
          patientId: patient,
          appointmentTypeId: type,
          start: '2026-09-28T09:00',
          allowOutsideAvailability: true,
        },
        META,
      );
      const { charge } = await due(patient, 5000, {
        appointmentId: appointment.id,
        payment: { amountCents: 3000, method: 'CHECK', reference: 'Chèque 1234567' },
      });
      expect(charge).toMatchObject({
        appointmentId: appointment.id,
        appointmentStartAt: '2026-09-28T07:00:00.000Z',
        practitionerId: drA,
        paidCents: 3000,
        remainingCents: 2000,
      });
      expect(charge.payments).toHaveLength(1);
      expect(charge.payments[0]).toMatchObject({ method: 'CHECK', reference: 'Chèque 1234567' });
      // Rendez-vous d'un autre patient, ou encaissement supérieur au dû : refus, rien n'est créé.
      await expect(
        due(await newPatient(), 5000, { appointmentId: appointment.id }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        due(patient, 5000, { payment: { amountCents: 5001, method: 'CASH' } }),
      ).rejects.toMatchObject({ code: 'AMOUNT_EXCEEDS_REMAINING' });
      expect((await finance.account(secretary, patient)).charges).toHaveLength(1);
    });

    it('patient archivé : aucun nouvel acte, mais son restant dû reste encaissable', async () => {
      const patient = await newPatient();
      const { charge } = await due(patient, 4000);
      const detail = await patientsService.get(secretary, patient);
      await patientsService.archive(secretary, patient, detail.version, META);
      await expect(due(patient, 1000)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await pay(charge.id, 4000)).charge.paymentState).toBe('PAID');
    });
  });

  describe('doubles soumissions et concurrence', () => {
    it('même clé : même objet, rien en double ; même clé, autre contenu : refus', async () => {
      const patient = await newPatient();
      const key = randomUUID();
      const request = {
        idempotencyKey: key,
        patientId: patient,
        label: 'Couronne',
        amountCents: 60000,
      };
      const first = await finance.createCharge(secretary, request, META);
      const again = await finance.createCharge(secretary, request, META);
      expect(again).toMatchObject({ replayed: true, charge: { id: first.charge.id } });
      await expect(
        finance.createCharge(secretary, { ...request, amountCents: 50000 }, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });

      const paymentKey = randomUUID();
      const payment = {
        idempotencyKey: paymentKey,
        chargeId: first.charge.id,
        amountCents: 20000,
        method: 'CARD' as const,
      };
      // Double clic : deux envois simultanés de la même saisie.
      const [x, y] = await Promise.all([
        finance.recordPayment(secretary, payment, META),
        finance.recordPayment(secretary, payment, META),
      ]);
      expect(x.payment.id).toBe(y.payment.id);
      expect([x.replayed, y.replayed].sort()).toEqual([false, true]);
      await expect(
        finance.recordPayment(secretary, { ...payment, amountCents: 20001 }, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const rows = await withTenant(t.appDb, clinic.id, (tx) =>
        tx
          .select({ id: payments.id })
          .from(payments)
          .where(and(eq(payments.clinicId, clinic.id), eq(payments.chargeId, first.charge.id))),
      );
      expect(rows).toHaveLength(1);
    });

    it('création avec encaissement envoyée deux fois en même temps : un seul acte, un seul paiement', async () => {
      const patient = await newPatient();
      const request = {
        idempotencyKey: randomUUID(),
        patientId: patient,
        label: 'Soin',
        amountCents: 8000,
        payment: { amountCents: 8000, method: 'CASH' as const },
      };
      const results = await Promise.all([
        finance.createCharge(secretary, request, META),
        finance.createCharge(secretary, request, META),
      ]);
      expect(new Set(results.map((r) => r.charge.id)).size).toBe(1);
      const account = await finance.account(secretary, patient);
      expect(account.charges).toHaveLength(1);
      expect(account.charges[0]!.payments).toHaveLength(1);
      expect(account).toMatchObject({ dueCents: 8000, paidCents: 8000, remainingCents: 0 });
    });

    it('deux encaissements simultanés qui dépasseraient le dû : un seul est accepté', async () => {
      const patient = await newPatient();
      const { charge } = await due(patient, 6000);
      const results = await Promise.allSettled([pay(charge.id, 4000), pay(charge.id, 4000)]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(
        (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
      ).toMatchObject({ code: 'AMOUNT_EXCEEDS_REMAINING' });
      expect(await finance.account(secretary, patient)).toMatchObject({
        paidCents: 4000,
        remainingCents: 2000,
      });
    });

    it('deux annulations simultanées du même paiement : une seule réussit', async () => {
      const patient = await newPatient();
      const { charge } = await due(patient, 3000);
      const { payment } = await pay(charge.id, 3000);
      const results = await Promise.allSettled([
        finance.voidPayment(dentist, payment.id, { reason: 'Erreur de saisie' }, META),
        finance.voidPayment(dentist, payment.id, { reason: 'Erreur de saisie' }, META),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(
        (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
      ).toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('annulations', () => {
    it('paiement annulé (motif) : restant dû rétabli, historique conservé ; acte annulé seulement sans paiement', async () => {
      const patient = await newPatient();
      const { charge } = await due(patient, 5000);
      const { payment } = await pay(charge.id, 5000, { reference: 'Ticket 42' });
      await expect(
        finance.cancelCharge(dentist, charge.id, { reason: 'Erreur de tarif' }, META),
      ).rejects.toMatchObject({ code: 'CHARGE_HAS_PAYMENTS' });
      const voided = await finance.voidPayment(
        dentist,
        payment.id,
        { reason: 'Montant erroné' },
        META,
      );
      expect(voided.payment).toMatchObject({
        status: 'VOIDED',
        voidReason: 'Montant erroné',
        voidedBy: { id: dentist.userId },
      });
      expect(voided.charge).toMatchObject({ paidCents: 0, remainingCents: 5000 });
      expect(voided.charge.payments).toHaveLength(1);
      const cancelled = await finance.cancelCharge(
        dentist,
        charge.id,
        { reason: 'Erreur de tarif' },
        META,
      );
      expect(cancelled).toMatchObject({ status: 'CANCELLED', remainingCents: 0 });
      await expect(pay(charge.id, 100)).rejects.toMatchObject({ code: 'CHARGE_NOT_OPEN' });
      await expect(
        finance.cancelCharge(dentist, charge.id, { reason: 'Encore' }, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await finance.account(dentist, patient)).toMatchObject({
        dueCents: 0,
        remainingCents: 0,
      });

      // Audit : montants et identifiants ; jamais le libellé, la référence ni le motif.
      const entries = await auditFor([charge.id, payment.id]);
      expect(entries.map((e) => e.action)).toEqual([
        'charge.created',
        'payment.recorded',
        'payment.voided',
        'charge.cancelled',
      ]);
      expect(entries[0]!.changes).toMatchObject({ amountCents: { to: 5000 }, label: {} });
      expect(entries[1]!.changes).toMatchObject({
        amountCents: { to: 5000 },
        method: { to: 'CARD' },
      });
      const text = JSON.stringify(entries);
      for (const secret of ['Détartrage', 'Ticket 42', 'Montant erroné', 'Erreur de tarif']) {
        expect(text).not.toContain(secret);
      }
    });

    it('motif obligatoire ; paiement inconnu : 404', async () => {
      await expect(
        finance.voidPayment(dentist, randomUUID(), { reason: '' }, META),
      ).rejects.toMatchObject({ name: 'ZodError' });
      await expect(
        finance.voidPayment(dentist, randomUUID(), { reason: 'Erreur de saisie' }, META),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('permissions et isolation', () => {
    it('secrétaire : saisit actes et paiements, n’annule rien, ne voit pas les revenus', async () => {
      const patient = await newPatient();
      const { charge } = await due(patient, 2000);
      const { payment } = await pay(charge.id, 1000);
      for (const attempt of [
        () => finance.voidPayment(secretary, payment.id, { reason: 'Erreur de saisie' }, META),
        () => finance.cancelCharge(secretary, charge.id, { reason: 'Erreur de saisie' }, META),
        () => finance.revenue(secretary, { from: '2026-09-01', to: '2026-09-30' }),
        () => finance.journal(secretary, { from: '2026-09-01', to: '2026-09-30' }),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      await finance.revenue(dentist, { from: '2026-09-01', to: '2026-09-30' });
      await finance.journal(admin, { from: '2026-09-01', to: '2026-09-30' });
    });

    it('un autre cabinet ne voit ni ne paie rien ; ses revenus ne comptent pas ceux-ci', async () => {
      const patient = await newPatient();
      const { charge } = await due(patient, 2500);
      await pay(charge.id, 2500);
      await expect(finance.account(otherAdmin, patient)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(
        finance.recordPayment(
          otherAdmin,
          { idempotencyKey: randomUUID(), chargeId: charge.id, amountCents: 1, method: 'CASH' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        finance.voidPayment(
          otherAdmin,
          charge.payments[0]?.id ?? randomUUID(),
          { reason: 'Test' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(
        await finance.revenue(otherAdmin, { from: '2026-09-01', to: '2026-10-31' }),
      ).toMatchObject({ totalCents: 0, paymentsCount: 0, remainingCents: 0 });
      expect((await finance.receivables(otherAdmin)).patients).toEqual([]);
    });
  });

  describe('revenus et restant dû', () => {
    it('revenus : sommes encaissées de la période, jour du cabinet, annulés à part, ventilations', async () => {
      // Cabinet dédié : aucun autre paiement dans la période.
      const own = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
      const boss = await actor(own, 'ADMIN');
      const reception = await actor(own, 'SECRETARY');
      const doc = (
        await practitionersService.createPractitioner(
          boss,
          { displayName: 'Dr Revenus', color: '#0ea5e9' },
          META,
        )
      ).id;
      const patientId = (
        await patientsService.create(
          reception,
          { lastName: 'Revenus', firstName: 'Un', contacts: [] },
          META,
        )
      ).id;
      const at = (instant: string) =>
        createFinanceService({ db: t.appDb, now: () => new Date(instant) });
      const charge = (
        await at('2026-09-28T08:00:00Z').createCharge(
          reception,
          {
            idempotencyKey: randomUUID(),
            patientId,
            practitionerId: doc,
            label: 'Implant',
            amountCents: 100000,
          },
          META,
        )
      ).charge;
      const noPractitioner = (
        await at('2026-09-28T08:00:00Z').createCharge(
          reception,
          { idempotencyKey: randomUUID(), patientId, label: 'Divers', amountCents: 5000 },
          META,
        )
      ).charge;
      const record = (instant: string, chargeId: string, amountCents: number, method: string) =>
        at(instant).recordPayment(
          reception,
          { idempotencyKey: randomUUID(), chargeId, amountCents, method: method as 'CARD' },
          META,
        );
      // Lundi 28 à 23 h 30 à Paris (21 h 30 UTC) : compte le 28.
      await record('2026-09-28T21:30:00Z', charge.id, 30000, 'CARD');
      // Mardi 29 à 0 h 30 à Paris (22 h 30 UTC le 28) : compte le 29.
      await record('2026-09-28T22:30:00Z', charge.id, 20000, 'CASH');
      await record('2026-09-29T09:00:00Z', noPractitioner.id, 5000, 'CARD');
      const mistake = await record('2026-09-29T10:00:00Z', charge.id, 1000, 'CHECK');
      await finance.voidPayment(boss, mistake.payment.id, { reason: 'Saisie en double' }, META);

      const day28 = await finance.revenue(boss, { from: '2026-09-28', to: '2026-09-28' });
      expect(day28).toMatchObject({ totalCents: 30000, paymentsCount: 1 });
      const both = await finance.revenue(boss, { from: '2026-09-28', to: '2026-09-29' });
      expect(both).toMatchObject({
        currency: 'EUR',
        totalCents: 55000,
        paymentsCount: 3,
        voided: { amountCents: 1000, count: 1 },
        // Restant dû : 100 000 − 50 000 sur l'implant, 0 sur « Divers ».
        remainingCents: 50000,
      });
      expect(both.byDay).toEqual([
        { date: '2026-09-28', amountCents: 30000, count: 1 },
        { date: '2026-09-29', amountCents: 25000, count: 2 },
      ]);
      expect(both.byMethod).toEqual([
        { method: 'CARD', amountCents: 35000, count: 2 },
        { method: 'CASH', amountCents: 20000, count: 1 },
      ]);
      expect(both.byPractitioner).toEqual([
        { practitionerId: doc, displayName: 'Dr Revenus', amountCents: 50000, count: 2 },
        { practitionerId: null, displayName: null, amountCents: 5000, count: 1 },
      ]);
      const journal = await finance.journal(boss, { from: '2026-09-28', to: '2026-09-29' });
      expect(journal.payments).toHaveLength(4);
      expect(journal.payments[0]).toMatchObject({
        status: 'VOIDED',
        chargeLabel: 'Implant',
        patient: { lastName: 'Revenus' },
      });
      await expect(
        finance.revenue(boss, { from: '2026-01-01', to: '2027-12-31' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('à encaisser : patients qui doivent de l’argent, du plus ancien au plus récent', async () => {
      const own = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
      const reception = await actor(own, 'SECRETARY');
      const patient = async (lastName: string) =>
        (await patientsService.create(reception, { lastName, firstName: 'X', contacts: [] }, META))
          .id;
      const at = (instant: string) =>
        createFinanceService({ db: t.appDb, now: () => new Date(instant) });
      const [ancien, recent, solde] = [
        await patient('Ancien'),
        await patient('Recent'),
        await patient('Solde'),
      ];
      const make = (patientId: string, amountCents: number) =>
        at('2026-09-28T08:00:00Z').createCharge(
          reception,
          { idempotencyKey: randomUUID(), patientId, label: 'Acte', amountCents },
          META,
        );
      const a1 = (await make(ancien, 3000)).charge;
      await make(recent, 2000);
      const s1 = (await make(solde, 1000)).charge;
      await at('2026-09-28T09:00:00Z').recordPayment(
        reception,
        { idempotencyKey: randomUUID(), chargeId: a1.id, amountCents: 1000, method: 'CASH' },
        META,
      );
      await at('2026-09-28T09:00:00Z').recordPayment(
        reception,
        { idempotencyKey: randomUUID(), chargeId: s1.id, amountCents: 1000, method: 'CASH' },
        META,
      );
      const list = await finance.receivables(reception);
      expect(list.totalRemainingCents).toBe(4000);
      expect(
        list.patients.map((p) => [p.patient.lastName, p.remainingCents, p.openCharges]),
      ).toEqual([
        ['Ancien', 2000, 1],
        ['Recent', 2000, 1],
      ]);
    });

    it('l’annulation d’un import ne supprime jamais un patient qui a un montant dû', async () => {
      const imports = createImportsService(deps);
      const batch = await imports.create(
        admin,
        { kind: 'PATIENTS', fileName: 'export.csv', totalRows: 2, dateFormat: 'DD/MM/YYYY' },
        META,
      );
      await imports.addRows(admin, batch.id, {
        rows: [
          { line: 2, lastName: 'Facture', firstName: 'Avec' },
          { line: 3, lastName: 'Facture', firstName: 'Sans' },
        ],
      });
      await imports.commit(admin, batch.id, META);
      const found = await patientsService.list(secretary, { q: 'facture avec' });
      await due(found.patients[0]!.id, 1500);
      expect(await imports.revert(admin, batch.id, META)).toMatchObject({ deleted: 1, kept: 1 });
    });
  });
});
