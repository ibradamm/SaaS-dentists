import { randomUUID } from 'node:crypto';
import type { DashboardResponse } from '@dental/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser, testClock } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import {
  appointments,
  availabilityBlocks,
  charges,
  patients,
  payments,
  workingIntervals,
  workingSchedules,
  type Clinic,
} from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import type { UserActor } from '../../auth/auth.types';
import { createPractitionersService } from '../../scheduling/practitioners.service';
import { createFinanceService } from '../../finance/finance.service';
import { createStatsService } from '../stats.service';

/*
 * Jeu de données de septembre 2026 (cabinet à Paris, UTC+2 jusqu'au 25 octobre) dont chaque
 * total est calculé à la main ci-dessous. Maintenant : lundi 28 septembre, 10 h à Paris.
 */
describe('tableau de bord : calculs sur données réelles', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  const clock = testClock(new Date('2026-09-28T08:00:00Z'));
  const deps = { db: t.appDb, now: clock.now };
  const stats = createStatsService(deps);
  const finance = createFinanceService(deps);
  const practitionersService = createPractitionersService(deps);

  let clinic: Clinic;
  let other: Clinic;
  let admin: UserActor;
  let dentist: UserActor;
  let secretary: UserActor;
  let otherAdmin: UserActor;
  const ids = {} as Record<string, string>;

  const insert = <T>(c: Clinic, run: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(t.appDb, c.id, run);
  const utc = (iso: string) => new Date(iso);
  const minutes = (n: number) => n * 60_000;

  async function patient(
    c: Clinic,
    key: string,
    createdAt: string,
    extra: { source?: 'STAFF' | 'IMPORT'; status?: 'ACTIVE' | 'ARCHIVED' } = {},
  ) {
    ids[key] = randomUUID();
    await insert(c, (tx) =>
      tx.insert(patients).values({
        id: ids[key],
        clinicId: c.id,
        lastName: key,
        firstName: 'Test',
        searchText: `${key.toLowerCase()} test`,
        createdSource: extra.source ?? 'STAFF',
        status: extra.status ?? 'ACTIVE',
        createdAt: utc(createdAt),
      }),
    );
  }

  async function appointment(
    c: Clinic,
    key: string,
    values: {
      practitioner: string;
      patient: string;
      type: string;
      start: string;
      minutes: number;
      status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
    },
  ) {
    ids[key] = randomUUID();
    const start = utc(values.start);
    await insert(c, (tx) =>
      tx.insert(appointments).values({
        id: ids[key],
        clinicId: c.id,
        practitionerId: ids[values.practitioner]!,
        patientId: ids[values.patient]!,
        appointmentTypeId: ids[values.type]!,
        startAt: start,
        endAt: new Date(start.getTime() + minutes(values.minutes)),
        status: values.status,
      }),
    );
  }

  async function charge(
    c: Clinic,
    key: string,
    values: {
      patient: string;
      appointment?: string;
      practitioner?: string;
      amount: number;
      cancelled?: boolean;
    },
  ) {
    ids[key] = randomUUID();
    await insert(c, async (tx) => {
      await tx.insert(charges).values({
        id: ids[key],
        clinicId: c.id,
        patientId: ids[values.patient]!,
        appointmentId: values.appointment ? ids[values.appointment]! : null,
        practitionerId: values.practitioner ? ids[values.practitioner]! : null,
        label: 'Acte',
        amountCents: values.amount,
        currency: 'EUR',
        idempotencyKey: randomUUID(),
      });
      if (values.cancelled) {
        await tx
          .update(charges)
          .set({
            status: 'CANCELLED',
            cancelledAt: clock.now(),
            cancelledBy: admin.userId,
            cancellationReason: 'Erreur de saisie',
          })
          .where(and(eq(charges.clinicId, c.id), eq(charges.id, ids[key]!)));
      }
    });
  }

  async function pay(
    c: Clinic,
    chargeKey: string,
    patientKey: string,
    amount: number,
    receivedAt: string,
    method: 'CASH' | 'CARD' | 'CHECK' | 'TRANSFER' = 'CARD',
    voided = false,
  ) {
    const id = randomUUID();
    await insert(c, async (tx) => {
      await tx.insert(payments).values({
        id,
        clinicId: c.id,
        patientId: ids[patientKey]!,
        chargeId: ids[chargeKey]!,
        amountCents: amount,
        currency: 'EUR',
        method,
        receivedAt: utc(receivedAt),
        idempotencyKey: randomUUID(),
      });
      if (voided) {
        await tx
          .update(payments)
          .set({
            status: 'VOIDED',
            voidedAt: clock.now(),
            voidedBy: admin.userId,
            voidReason: 'Erreur de saisie',
          })
          .where(and(eq(payments.clinicId, c.id), eq(payments.id, id)));
      }
    });
  }

  const september = (actor: UserActor = dentist, extra: Record<string, unknown> = {}) =>
    stats.dashboard(actor, { from: '2026-09-01', to: '2026-09-30', ...extra });

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
    other = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
    const actor = async (c: Clinic, role: 'ADMIN' | 'DENTIST' | 'SECRETARY') =>
      actorFor((await createUser(t.ownerDb, c.id, role)).id, role, c.id);
    admin = await actor(clinic, 'ADMIN');
    dentist = await actor(clinic, 'DENTIST');
    secretary = await actor(clinic, 'SECRETARY');
    otherAdmin = await actor(other, 'ADMIN');

    for (const [key, name] of [
      ['A', 'Dr A'],
      ['B', 'Dr B'],
      ['C', 'Dr Ancien'],
    ] as const) {
      ids[key] = (
        await practitionersService.createPractitioner(
          admin,
          { displayName: name, color: '#0ea5e9' },
          META,
        )
      ).id;
    }
    for (const [key, name] of [
      ['consult', 'Consultation'],
      ['detartrage', 'Détartrage'],
      ['radio', 'Radio'],
    ] as const) {
      ids[key] = (
        await practitionersService.createType(
          admin,
          { name, durationMinutes: 30, color: '#10b981' },
          META,
        )
      ).id;
    }
    // Dr A : du lundi au vendredi, 9 h - 12 h. Dr B : le lundi, 14 h - 18 h. Dr C : aucun horaire.
    // Horaires passés : écrits directement (le service n'accepte que des dates à venir).
    const schedule = (key: string, days: number[], startMinute: number, endMinute: number) =>
      insert(clinic, async (tx) => {
        const scheduleId = randomUUID();
        await tx.insert(workingSchedules).values({
          id: scheduleId,
          clinicId: clinic.id,
          practitionerId: ids[key]!,
          validFrom: '2026-01-01',
        });
        await tx.insert(workingIntervals).values(
          days.map((weekday) => ({
            clinicId: clinic.id,
            scheduleId,
            weekday,
            startMinute,
            endMinute,
          })),
        );
      });
    await schedule('A', [1, 2, 3, 4, 5], 540, 720);
    await schedule('B', [1], 840, 1080);
    // Absence de Dr A le mercredi 16 septembre au matin.
    await insert(clinic, (tx) =>
      tx.insert(availabilityBlocks).values({
        clinicId: clinic.id,
        practitionerId: ids.A!,
        kind: 'ABSENCE',
        startAt: utc('2026-09-16T07:00:00Z'),
        endAt: utc('2026-09-16T10:00:00Z'),
      }),
    );

    // Patients : P1 et P2 créés en septembre ; P3 importé en septembre ; P4 créé en août ;
    // P5 créé le 1er octobre à 0 h 30 (30 septembre en UTC) ; P6 archivé.
    await patient(clinic, 'P1', '2026-09-02T08:00:00Z');
    await patient(clinic, 'P2', '2026-09-15T08:00:00Z');
    await patient(clinic, 'P3', '2026-09-10T08:00:00Z', { source: 'IMPORT' });
    await patient(clinic, 'P4', '2026-08-20T08:00:00Z');
    await patient(clinic, 'P5', '2026-09-30T22:30:00Z');
    await patient(clinic, 'P6', '2026-01-10T08:00:00Z', { status: 'ARCHIVED' });
    // P7 : créé en juillet, seulement absent en septembre (jamais « vu »).
    await patient(clinic, 'P7', '2026-07-01T08:00:00Z');

    const a = (key: string, v: Parameters<typeof appointment>[2]) => appointment(clinic, key, v);
    // 1er septembre à 0 h 30 à Paris (31 août en UTC), hors horaires : compte en septembre.
    await a('a1', {
      practitioner: 'A',
      patient: 'P4',
      type: 'consult',
      start: '2026-08-31T22:30:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    await a('a2', {
      practitioner: 'A',
      patient: 'P1',
      type: 'consult',
      start: '2026-09-07T07:00:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    await a('a3', {
      practitioner: 'A',
      patient: 'P2',
      type: 'detartrage',
      start: '2026-09-07T07:30:00Z',
      minutes: 45,
      status: 'COMPLETED',
    });
    await a('a4', {
      practitioner: 'A',
      patient: 'P7',
      type: 'consult',
      start: '2026-09-08T07:00:00Z',
      minutes: 30,
      status: 'NO_SHOW',
    });
    await a('a5', {
      practitioner: 'A',
      patient: 'P1',
      type: 'radio',
      start: '2026-09-09T07:00:00Z',
      minutes: 30,
      status: 'CANCELLED',
    });
    await a('a6', {
      practitioner: 'A',
      patient: 'P2',
      type: 'consult',
      start: '2026-09-29T09:00:00Z',
      minutes: 30,
      status: 'SCHEDULED',
    });
    // 13 h, hors horaires : compté dans l'activité, pas dans l'occupation du planning.
    await a('a7', {
      practitioner: 'A',
      patient: 'P3',
      type: 'consult',
      start: '2026-09-07T11:00:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    // 1er octobre à 0 h 30 à Paris (30 septembre en UTC) : octobre.
    await a('a8', {
      practitioner: 'A',
      patient: 'P1',
      type: 'consult',
      start: '2026-09-30T22:30:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    await a('a9', {
      practitioner: 'A',
      patient: 'P1',
      type: 'consult',
      start: '2026-10-06T07:00:00Z',
      minutes: 30,
      status: 'SCHEDULED',
    });
    await a('b1', {
      practitioner: 'B',
      patient: 'P4',
      type: 'consult',
      start: '2026-09-14T12:00:00Z',
      minutes: 60,
      status: 'COMPLETED',
    });
    await a('b2', {
      practitioner: 'B',
      patient: 'P1',
      type: 'detartrage',
      start: '2026-09-21T12:00:00Z',
      minutes: 30,
      status: 'SCHEDULED',
    });
    await a('c1', {
      practitioner: 'C',
      patient: 'P1',
      type: 'radio',
      start: '2026-09-02T08:00:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    // Août (période précédente).
    await a('x1', {
      practitioner: 'A',
      patient: 'P1',
      type: 'consult',
      start: '2026-08-31T07:00:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    // Changement d'heure du 25 octobre (journée de 25 heures) : 0 h 30 et 23 h 30 le 25, 0 h 30 le 26.
    await a('d1', {
      practitioner: 'B',
      patient: 'P2',
      type: 'consult',
      start: '2026-10-24T22:30:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    await a('d2', {
      practitioner: 'B',
      patient: 'P2',
      type: 'consult',
      start: '2026-10-25T22:30:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    await a('d3', {
      practitioner: 'B',
      patient: 'P3',
      type: 'consult',
      start: '2026-10-25T23:30:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    const archived = await practitionersService.listPractitioners(admin, { includeArchived: true });
    const c = archived.find((p) => p.id === ids.C)!;
    await practitionersService.archivePractitioner(admin, ids.C!, c.version, META);

    // Actes et paiements.
    await charge(clinic, 'ch1', {
      patient: 'P1',
      appointment: 'a2',
      practitioner: 'A',
      amount: 6000,
    });
    await pay(clinic, 'ch1', 'P1', 6000, '2026-09-07T08:00:00Z', 'CARD');
    await charge(clinic, 'ch2', {
      patient: 'P4',
      appointment: 'b1',
      practitioner: 'B',
      amount: 8000,
    });
    await pay(clinic, 'ch2', 'P4', 3000, '2026-09-14T13:00:00Z', 'CASH');
    // 1er septembre à 0 h 30 à Paris : septembre.
    await pay(clinic, 'ch2', 'P4', 2000, '2026-08-31T22:30:00Z', 'CASH');
    await pay(clinic, 'ch2', 'P4', 1000, '2026-09-15T08:00:00Z', 'CHECK', true);
    // Acte annulé : le rendez-vous a7 reste « sans acte ».
    await charge(clinic, 'ch3', {
      patient: 'P3',
      appointment: 'a7',
      practitioner: 'A',
      amount: 5000,
      cancelled: true,
    });
    await charge(clinic, 'ch4', { patient: 'P2', amount: 4000 });
    // 1er octobre à 0 h 30 à Paris : octobre ; 15 août : période précédente.
    await pay(clinic, 'ch4', 'P2', 1500, '2026-09-30T22:30:00Z', 'TRANSFER');
    await pay(clinic, 'ch4', 'P2', 2500, '2026-08-15T08:00:00Z', 'CASH');

    // Autre cabinet, même période : ne doit jamais apparaître.
    const o = await practitionersService.createPractitioner(
      otherAdmin,
      { displayName: 'Dr Autre', color: '#000000' },
      META,
    );
    ids.O = o.id;
    ids.oType = (
      await practitionersService.createType(
        otherAdmin,
        { name: 'Autre', durationMinutes: 30, color: '#000000' },
        META,
      )
    ).id;
    await patient(other, 'Q1', '2026-09-03T08:00:00Z');
    await appointment(other, 'o1', {
      practitioner: 'O',
      patient: 'Q1',
      type: 'oType',
      start: '2026-09-07T07:00:00Z',
      minutes: 30,
      status: 'COMPLETED',
    });
    await charge(other, 'och', {
      patient: 'Q1',
      appointment: 'o1',
      practitioner: 'O',
      amount: 99900,
    });
    await pay(other, 'och', 'Q1', 99900, '2026-09-07T08:00:00Z');
  });
  afterAll(() => t.close());

  it('activité de septembre : statuts, taux, patients vus, à venir, types fréquents', async () => {
    const d = await september();
    expect(d).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      previous: { from: '2026-08-01', to: '2026-08-31' },
      granularity: 'day',
      timezone: 'Europe/Paris',
      currency: 'EUR',
      practitionerId: null,
    });
    const activity = d.activity!;
    // Honorés : a1, a2, a3, a7, b1, c1 ; absent : a4 ; annulé : a5 ; prévus : a6, b2.
    expect(activity).toMatchObject({
      total: 9,
      scheduled: 2,
      completed: 6,
      noShow: 1,
      cancelled: 1,
      patientsSeen: 4,
      previousCompleted: 1,
      upcomingNext7Days: 1,
    });
    expect(activity.noShowRate).toBeCloseTo(1 / 7, 10);
    expect(activity.presenceRate).toBeCloseTo(6 / 7, 10);
    expect(activity.cancellationRate).toBeCloseTo(1 / 10, 10);
    expect(activity.topTypes.map((x) => [x.name, x.count])).toEqual([
      ['Consultation', 6],
      ['Détartrage', 2],
      ['Radio', 1],
    ]);
    expect(activity.topTypes[0]!.share).toBeCloseTo(6 / 9, 10);
    // Tranches par jour, en jours de Paris : a1 le 1er, a2 + a3 + a7 le 7, rien le 30.
    expect(activity.series).toHaveLength(30);
    expect(activity.series[0]).toEqual({
      start: '2026-09-01',
      scheduled: 0,
      completed: 1,
      noShow: 0,
      cancelled: 0,
    });
    expect(activity.series[6]).toMatchObject({ start: '2026-09-07', completed: 3 });
    expect(activity.series[29]).toMatchObject({ start: '2026-09-30', completed: 0 });
    const totalFromSeries = activity.series.reduce((s, b) => s + b.completed, 0);
    expect(totalFromSeries).toBe(6);
  });

  it('occupation du planning : absents comptés, annulés et hors horaires exclus, jamais plus de 100 %', async () => {
    const { activity } = await september();
    const byId = new Map(activity!.byPractitioner.map((p) => [p.practitionerId, p]));
    // Dr A : 22 jours ouvrés × 180 min − absence du 16 (180) = 3 780 ; réservé au planning :
    // a2 30 + a3 45 + a4 30 (absent : le créneau était réservé) + a6 30 = 135. a1 et a7, hors
    // horaires, ne comptent pas ; a5, annulé, non plus.
    expect(byId.get(ids.A!)).toMatchObject({
      displayName: 'Dr A',
      openMinutes: 3780,
      bookedMinutes: 135,
      total: 6,
      completed: 4,
      noShow: 1,
      cancelled: 1,
    });
    expect(byId.get(ids.A!)!.rate).toBeCloseTo(135 / 3780, 10);
    // Dr B : 4 lundis × 240 = 960 ; réservé : b1 60 + b2 30.
    expect(byId.get(ids.B!)).toMatchObject({ openMinutes: 960, bookedMinutes: 90, completed: 1 });
    // Dr C, archivé, sans horaires mais avec un rendez-vous : affiché, occupation vide.
    expect(byId.get(ids.C!)).toMatchObject({ openMinutes: 0, bookedMinutes: 0, rate: null });
    expect(activity!.occupancy).toEqual({
      openMinutes: 4740,
      bookedMinutes: 225,
      rate: 225 / 4740,
    });
  });

  it('patients : actifs, nouveaux (imports exclus), période précédente', async () => {
    const d = await september();
    // Actifs : P1 à P5 et P7 ; nouveaux en septembre : P1, P2 (P3 importé, P5 en octobre) ; août : P4.
    expect(d.patients).toEqual({ active: 6, new: 2, previousNew: 1 });
  });

  it('revenus : encaissé en jours de Paris, annulés à part, période précédente, praticiens', async () => {
    const { revenue } = await september();
    // Septembre : 6 000 + 3 000 + 2 000 (1er septembre à 0 h 30) ; annulé : 1 000 ; août : 2 500.
    expect(revenue).toMatchObject({
      totalCents: 11000,
      count: 3,
      previousTotalCents: 2500,
      voided: { amountCents: 1000, count: 1 },
      byPractitioner: [
        { practitionerId: ids.A, displayName: 'Dr A', amountCents: 6000, count: 1 },
        { practitionerId: ids.B, displayName: 'Dr B', amountCents: 5000, count: 2 },
      ],
    });
    expect(revenue!.series[0]).toEqual({ start: '2026-09-01', amountCents: 2000, count: 1 });
    expect(revenue!.series[6]).toEqual({ start: '2026-09-07', amountCents: 6000, count: 1 });
    expect(revenue!.series.reduce((s, b) => s + b.amountCents, 0)).toBe(11000);
  });

  it('encaissements : restant dû du cabinet, rendez-vous honorés sans acte ouvert', async () => {
    const d = await september();
    // ch1 soldé, ch2 : 8 000 − 5 000, ch3 annulé, ch4 soldé.
    expect(d.receivables).toEqual({ totalRemainingCents: 3000, patients: 1 });
    // Honorés sans acte ouvert : a1, a3, a7 (acte annulé), c1 ; du plus récent au plus ancien.
    expect(d.unbilled!.count).toBe(4);
    expect(d.unbilled!.items.map((i) => i.appointmentId)).toEqual([ids.a7, ids.a3, ids.c1, ids.a1]);
    expect(d.unbilled!.items[0]).toMatchObject({
      patient: { id: ids.P3, lastName: 'P3' },
      appointmentTypeName: 'Consultation',
    });
  });

  it('filtre praticien : activité, occupation, revenus et actes manquants de ce seul praticien', async () => {
    const d = await september(dentist, { practitionerId: ids.A });
    expect(d.practitionerId).toBe(ids.A);
    expect(d.activity).toMatchObject({ total: 6, completed: 4, noShow: 1, cancelled: 1 });
    expect(d.activity!.byPractitioner.map((p) => p.practitionerId)).toEqual([ids.A]);
    expect(d.activity!.occupancy).toMatchObject({ openMinutes: 3780, bookedMinutes: 135 });
    expect(d.revenue).toMatchObject({ totalCents: 6000, count: 1, previousTotalCents: 0 });
    expect(d.unbilled!.count).toBe(3);
    // Les patients et le restant dû restent ceux du cabinet.
    expect(d.patients).toEqual({ active: 6, new: 2, previousNew: 1 });
    expect(d.receivables).toEqual({ totalRemainingCents: 3000, patients: 1 });
  });

  it('année : tranches mensuelles ; octobre : journée de 25 heures au changement d’heure', async () => {
    const year = await stats.dashboard(dentist, { from: '2026-01-01', to: '2026-12-31' });
    expect(year.granularity).toBe('month');
    expect(year.previous).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(year.activity!.series.map((b) => b.start)).toHaveLength(12);
    expect(year.activity!.series[7]).toMatchObject({ start: '2026-08-01', completed: 1 });
    expect(year.activity!.series[8]).toMatchObject({ start: '2026-09-01', completed: 6 });
    // Octobre : a8 (1er), d1, d2, d3.
    expect(year.activity!.series[9]).toMatchObject({ start: '2026-10-01', completed: 4 });

    const october = await stats.dashboard(dentist, { from: '2026-10-01', to: '2026-10-31' });
    const day = (date: string) => october.activity!.series.find((b) => b.start === date)!;
    expect(day('2026-10-01').completed).toBe(1);
    expect(day('2026-10-24').completed).toBe(0);
    expect(day('2026-10-25').completed).toBe(2);
    expect(day('2026-10-26').completed).toBe(1);
    // Revenus du 1er octobre à 0 h 30 (30 septembre en UTC).
    expect(october.revenue!.series[0]).toEqual({
      start: '2026-10-01',
      amountCents: 1500,
      count: 1,
    });

    const week = await stats.dashboard(dentist, { from: '2026-09-28', to: '2026-10-04' });
    expect(week.granularity).toBe('day');
    expect(week.previous).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  it('permissions : la secrétaire n’a pas la section revenus ; le calcul n’est pas fait', async () => {
    const d = await september(secretary);
    expect(Object.keys(d).filter((k) => d[k as keyof DashboardResponse] !== undefined)).toEqual(
      expect.arrayContaining(['activity', 'patients', 'receivables', 'unbilled']),
    );
    expect(d.revenue).toBeUndefined();
    expect('revenue' in d).toBe(false);
    const a = await september(admin);
    expect(a.revenue?.totalCents).toBe(11000);
  });

  it('isolation : l’autre cabinet ne voit rien de celui-ci, ni l’inverse ; praticien étranger : 404', async () => {
    const mine = await september();
    expect(mine.revenue!.totalCents).toBe(11000);
    const theirs = await september(otherAdmin);
    expect(theirs.activity).toMatchObject({ total: 1, completed: 1 });
    expect(theirs.revenue).toMatchObject({ totalCents: 99900, count: 1 });
    expect(theirs.patients).toEqual({ active: 1, new: 1, previousNew: 0 });
    await expect(september(otherAdmin, { practitionerId: ids.A })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(september(dentist, { practitionerId: randomUUID() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('données vides : zéros, séries complètes, taux absents (jamais 0 % ni division par zéro)', async () => {
    const empty = await createTestClinic(t.ownerDb, {
      timezone: 'America/New_York',
      currency: 'USD',
    });
    const owner = actorFor((await createUser(t.ownerDb, empty.id, 'ADMIN')).id, 'ADMIN', empty.id);
    const d = await stats.dashboard(owner, { from: '2026-09-01', to: '2026-09-30' });
    expect(d).toMatchObject({ timezone: 'America/New_York', currency: 'USD' });
    expect(d.activity).toMatchObject({
      total: 0,
      completed: 0,
      noShowRate: null,
      presenceRate: null,
      cancellationRate: null,
      patientsSeen: 0,
      upcomingNext7Days: 0,
      occupancy: { openMinutes: 0, bookedMinutes: 0, rate: null },
      byPractitioner: [],
      topTypes: [],
    });
    expect(d.activity!.series).toHaveLength(30);
    expect(d.activity!.series.every((b) => b.completed + b.scheduled === 0)).toBe(true);
    expect(d.patients).toEqual({ active: 0, new: 0, previousNew: 0 });
    expect(d.receivables).toEqual({ totalRemainingCents: 0, patients: 0 });
    expect(d.unbilled).toEqual({ count: 0, exempt: 0, items: [] });
    expect(d.revenue).toMatchObject({
      totalCents: 0,
      count: 0,
      previousTotalCents: 0,
      byPractitioner: [],
    });
    expect(d.revenue!.series.every((b) => b.amountCents === 0)).toBe(true);
  });

  it('« sans facturation » : le rendez-vous gratuit sort des oublis d’encaissement, compté à part', async () => {
    await finance.setBillingExempt(secretary, ids.a1!, { billingExempt: true }, META);
    try {
      const d = await september();
      expect(d.unbilled!.count).toBe(3);
      expect(d.unbilled!.exempt).toBe(1);
      expect(d.unbilled!.items.map((i) => i.appointmentId)).not.toContain(ids.a1);
    } finally {
      await finance.setBillingExempt(secretary, ids.a1!, { billingExempt: false }, META);
    }
    expect((await september()).unbilled).toMatchObject({ count: 4, exempt: 0 });
  });

  it('période invalide ou trop longue : refus', async () => {
    await expect(
      stats.dashboard(dentist, { from: '2026-09-30', to: '2026-09-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      stats.dashboard(dentist, { from: '2025-01-01', to: '2026-01-02' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(stats.dashboard(dentist, { from: '2026-09-01' })).rejects.toThrow();
  });
});
