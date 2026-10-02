import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser, testClock } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import { appointments, auditLogs, type Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import { createSecretBox } from '../../../lib/secret-box';
import type { UserActor } from '../../auth/auth.types';
import { createImportsService } from '../../imports/imports.service';
import { createPatientsService } from '../../patients/patients.service';
import { createPractitionersService } from '../../scheduling/practitioners.service';
import { createSchedulesService } from '../../scheduling/schedules.service';
import { createAppointmentsService } from '../appointments.service';

const WEEKDAYS = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start: '09:00', end: '12:00' },
  { weekday, start: '14:00', end: '18:00' },
]);

describe('rendez-vous', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  // Lundi 28 septembre 2026, 8 h à Paris (UTC+2).
  const clock = testClock(new Date('2026-09-28T06:00:00Z'));
  const deps = { db: t.appDb, now: clock.now };
  const service = createAppointmentsService(deps);
  const schedules = createSchedulesService(deps);
  const practitionersService = createPractitionersService(deps);
  const patientsService = createPatientsService({
    ...deps,
    secretBox: createSecretBox(randomBytes(32)),
  });

  let clinic: Clinic;
  let admin: UserActor;
  let secretary: UserActor;
  let dentist: UserActor;
  let otherAdmin: UserActor;
  let drA: string;
  let drB: string;
  let consultation: string; // 30 min
  let soin: string; // 45 min

  const actor = async (c: Clinic, role: 'ADMIN' | 'DENTIST' | 'SECRETARY') =>
    actorFor((await createUser(t.ownerDb, c.id, role)).id, role, c.id);
  let patientCounter = 0;
  const newPatient = async (lastName = 'Patient') =>
    (
      await patientsService.create(
        secretary,
        { lastName, firstName: `N${(patientCounter += 1)}`, contacts: [] },
        META,
      )
    ).id;
  const book = (
    patientId: string,
    start: string,
    extra: Partial<Parameters<typeof service.create>[1]> = {},
    who: UserActor = secretary,
  ) =>
    service.create(
      who,
      { practitionerId: drA, patientId, appointmentTypeId: consultation, start, ...extra },
      META,
    );
  const auditFor = (id: string) =>
    withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select({ action: auditLogs.action, changes: auditLogs.changes })
        .from(auditLogs)
        .where(eq(auditLogs.entityId, id))
        // Ordre chronologique explicite : sans ORDER BY, PostgreSQL ne garantit aucun ordre.
        .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)),
    );

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    admin = await actor(clinic, 'ADMIN');
    secretary = await actor(clinic, 'SECRETARY');
    dentist = await actor(clinic, 'DENTIST');
    otherAdmin = await actor(await createTestClinic(t.ownerDb), 'ADMIN');
    drA = (
      await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr A', color: '#0ea5e9', userId: dentist.userId },
        META,
      )
    ).id;
    drB = (
      await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr B', color: '#10b981' },
        META,
      )
    ).id;
    for (const id of [drA, drB]) {
      await schedules.setSchedule(
        admin,
        id,
        { validFrom: '2026-09-28', basePeriod: null, intervals: WEEKDAYS },
        META,
      );
    }
    consultation = (
      await practitionersService.createType(
        admin,
        { name: 'Consultation', durationMinutes: 30, color: '#0ea5e9' },
        META,
      )
    ).id;
    soin = (
      await practitionersService.createType(
        admin,
        { name: 'Soin', durationMinutes: 45, color: '#8b5cf6' },
        META,
      )
    ).id;
  });
  afterAll(() => t.close());

  describe('création', () => {
    it('durée du type par défaut, modifiable ; heure locale convertie en UTC ; audit sans nom', async () => {
      const patient = await newPatient('Martin');
      const a = await book(patient, '2026-09-28T09:00');
      expect(a).toMatchObject({
        practitionerId: drA,
        startAt: '2026-09-28T07:00:00.000Z',
        endAt: '2026-09-28T07:30:00.000Z',
        durationMinutes: 30,
        status: 'SCHEDULED',
        patient: { id: patient, lastName: 'Martin' },
        appointmentType: { name: 'Consultation' },
      });
      const custom = await book(await newPatient(), '2026-09-28T10:00', {
        appointmentTypeId: soin,
        durationMinutes: 60,
      });
      expect(custom.durationMinutes).toBe(60);
      const [entry] = await auditFor(a.id);
      expect(entry?.action).toBe('appointment.created');
      expect(JSON.stringify(entry?.changes)).not.toContain('Martin');
    });

    it('plages adjacentes acceptées ; chevauchement refusé pour le praticien et pour le patient', async () => {
      const p1 = await newPatient();
      const p2 = await newPatient();
      await book(p1, '2026-09-29T09:00');
      await book(p2, '2026-09-29T09:30'); // adjacent
      await expect(book(await newPatient(), '2026-09-29T09:15')).rejects.toMatchObject({
        code: 'SLOT_UNAVAILABLE',
        message: expect.stringContaining('praticien') as string,
      });
      // Même patient chez un autre praticien au même moment.
      await expect(book(p1, '2026-09-29T09:10', { practitionerId: drB })).rejects.toMatchObject({
        code: 'SLOT_UNAVAILABLE',
        message: expect.stringContaining('patient') as string,
      });
      // Autre patient, autre praticien, même heure : accepté.
      await book(await newPatient(), '2026-09-29T09:00', { practitionerId: drB });
    });

    it('hors horaires : confirmation exigée, puis acceptée et tracée à part', async () => {
      const patient = await newPatient();
      await expect(book(patient, '2026-09-30T12:30')).rejects.toMatchObject({
        code: 'AVAILABILITY_CONFIRMATION_REQUIRED',
        message: expect.stringContaining('hors des horaires') as string,
      });
      const forced = await book(patient, '2026-09-30T12:30', { allowOutsideAvailability: true });
      const actions = (await auditFor(forced.id)).map((e) => e.action);
      expect(actions).toEqual(['appointment.created', 'appointment.availability_override']);
      const override = (await auditFor(forced.id)).find(
        (e) => e.action === 'appointment.availability_override',
      );
      expect(override?.changes).toMatchObject({ reasons: { to: 'OUTSIDE_WORKING_HOURS' } });
    });

    it('sur un créneau bloqué : confirmation exigée (libellé indiqué), puis tracée', async () => {
      await schedules.createBlock(
        dentist,
        {
          practitionerId: drA,
          kind: 'BLOCK',
          allDay: false,
          start: '2026-10-01T10:00',
          end: '2026-10-01T11:00',
          label: 'Réunion',
        },
        META,
      );
      const patient = await newPatient();
      await expect(book(patient, '2026-10-01T10:30')).rejects.toMatchObject({
        code: 'AVAILABILITY_CONFIRMATION_REQUIRED',
        message: expect.stringContaining('Réunion') as string,
      });
      const forced = await book(patient, '2026-10-01T10:30', { allowOutsideAvailability: true });
      const override = (await auditFor(forced.id)).find(
        (e) => e.action === 'appointment.availability_override',
      );
      expect(override?.changes).toMatchObject({ reasons: { to: 'ON_BLOCK' } });
    });

    it('pendant une absence (praticien ou cabinet) : refus, même avec confirmation', async () => {
      await schedules.createBlock(
        dentist,
        {
          practitionerId: drA,
          kind: 'ABSENCE',
          allDay: true,
          startDate: '2026-10-06',
          endDate: '2026-10-06',
          label: 'Formation',
        },
        META,
      );
      await schedules.createBlock(
        secretary,
        {
          practitionerId: null,
          kind: 'ABSENCE',
          allDay: true,
          startDate: '2026-10-07',
          endDate: '2026-10-07',
        },
        META,
      );
      const patient = await newPatient();
      for (const start of ['2026-10-06T10:00', '2026-10-07T10:00']) {
        await expect(
          book(patient, start, { allowOutsideAvailability: true }),
        ).rejects.toMatchObject({ code: 'PRACTITIONER_ABSENT' });
      }
      await expect(
        book(patient, '2026-10-07T10:00', { practitionerId: drB, allowOutsideAvailability: true }),
      ).rejects.toMatchObject({ code: 'PRACTITIONER_ABSENT' });
    });

    it('fuseau : heure locale de part et d’autre du changement d’heure ; heure inexistante refusée', async () => {
      const summer = await book(await newPatient(), '2026-10-23T09:00');
      const winter = await book(await newPatient(), '2026-10-26T09:00');
      expect(summer.startAt).toBe('2026-10-23T07:00:00.000Z');
      expect(winter.startAt).toBe('2026-10-26T08:00:00.000Z');
      // Nuit du retour à l'heure d'hiver : 60 minutes réelles.
      const night = await book(await newPatient(), '2026-10-25T01:30', {
        durationMinutes: 60,
        allowOutsideAvailability: true,
      });
      expect(Date.parse(night.endAt) - Date.parse(night.startAt)).toBe(60 * 60_000);
      await expect(
        book(await newPatient(), '2027-03-28T02:30', { allowOutsideAvailability: true }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('deux prises de rendez-vous simultanées sur le même créneau : une seule réussit', async () => {
      const [p1, p2] = [await newPatient(), await newPatient()];
      const results = await Promise.allSettled([
        book(p1, '2026-10-02T11:00'),
        service.create(
          admin,
          {
            practitionerId: drA,
            patientId: p2,
            appointmentTypeId: consultation,
            start: '2026-10-02T11:15',
          },
          META,
        ),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(
        (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
      ).toMatchObject({
        code: 'SLOT_UNAVAILABLE',
      });
      const onSlot = await service.list(secretary, {
        from: '2026-10-02',
        to: '2026-10-02',
        practitionerId: drA,
      });
      expect(onSlot.filter((a) => a.startAt.startsWith('2026-10-02T09'))).toHaveLength(1);
    });

    it('verrou : un rendez-vous ne se glisse pas dans une absence en cours de création', async () => {
      // Une autre transaction tient le verrou du praticien et crée une absence, pas encore
      // validée. La prise de rendez-vous doit attendre, puis voir l'absence et refuser.
      const patient = await newPatient();
      const other = await t.appPool.connect();
      try {
        await other.query('BEGIN');
        await other.query("SELECT set_config('app.clinic_id', $1, true)", [clinic.id]);
        await other.query("SELECT pg_advisory_xact_lock(hashtextextended('schedule:' || $1, 0))", [
          drB,
        ]);
        await other.query(
          `INSERT INTO availability_blocks (id, practitioner_id, kind, start_at, end_at, all_day)
           VALUES (gen_random_uuid(), $1, 'ABSENCE', '2026-10-19T22:00Z', '2026-10-20T22:00Z', true)`,
          [drB],
        );
        const pending = book(patient, '2026-10-20T10:00', { practitionerId: drB }).then(
          () => 'créé',
          (e: { code?: string }) => e.code,
        );
        // Attente (bornée) que la prise de rendez-vous bloque sur le verrou.
        for (let i = 0; i < 50; i += 1) {
          const { rows } = await t.ownerPool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
          );
          if (rows[0]!.n > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await other.query('COMMIT');
        expect(await pending).toBe('PRACTITIONER_ABSENT');
      } finally {
        other.release();
      }
    });

    it('refuse un praticien, un patient ou un type archivés', async () => {
      const type = await practitionersService.createType(
        admin,
        { name: 'Ancien soin', durationMinutes: 30, color: '#64748b' },
        META,
      );
      await practitionersService.archiveType(admin, type.id, type.version, META);
      await expect(
        book(await newPatient(), '2026-10-02T14:00', { appointmentTypeId: type.id }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const archivedPatient = await patientsService.create(
        secretary,
        { lastName: 'Archive', firstName: 'Paul', contacts: [] },
        META,
      );
      await patientsService.archive(secretary, archivedPatient.id, archivedPatient.version, META);
      await expect(book(archivedPatient.id, '2026-10-02T14:00')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('statuts', () => {
    it('honoré seulement après l’heure de début ; « annulé » définitif ; correction possible', async () => {
      const a = await book(await newPatient(), '2026-09-28T14:00');
      await expect(
        service.changeStatus(secretary, a.id, { version: a.version, status: 'COMPLETED' }, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      clock.advanceMinutes(6 * 60 + 5); // 14 h 05 à Paris
      const done = await service.changeStatus(
        secretary,
        a.id,
        { version: a.version, status: 'COMPLETED' },
        META,
      );
      expect(done.status).toBe('COMPLETED');
      await expect(
        service.changeStatus(secretary, a.id, { version: done.version, status: 'CANCELLED' }, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const corrected = await service.changeStatus(
        secretary,
        a.id,
        { version: done.version, status: 'SCHEDULED' },
        META,
      );
      const cancelled = await service.changeStatus(
        secretary,
        a.id,
        { version: corrected.version, status: 'CANCELLED', reason: 'Empêchement personnel' },
        META,
      );
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Empêchement personnel',
      });
      await expect(
        service.changeStatus(
          secretary,
          a.id,
          { version: cancelled.version, status: 'SCHEDULED' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const statusAudit = (await auditFor(a.id)).filter(
        (e) => e.action === 'appointment.status_changed',
      );
      expect(statusAudit.map((e) => e.changes)).toContainEqual({
        status: { from: 'SCHEDULED', to: 'CANCELLED' },
        cancellationReason: {},
      });
      expect(JSON.stringify(statusAudit)).not.toContain('Empêchement');
      // Le créneau annulé est libre (il est 14 h 05 : confirmation « dans le passé » exigée).
      await book(await newPatient(), '2026-09-28T14:00', { allowOutsideAvailability: true });
    });

    it('« patient absent » libère le créneau ; revenir à « prévu » est refusé s’il a été repris', async () => {
      const a = await book(await newPatient(), '2026-09-28T15:00');
      clock.advanceMinutes(60); // 15 h 05
      const noShow = await service.changeStatus(
        secretary,
        a.id,
        { version: a.version, status: 'NO_SHOW' },
        META,
      );
      await book(await newPatient(), '2026-09-28T15:10', { allowOutsideAvailability: false });
      await expect(
        service.changeStatus(
          secretary,
          a.id,
          { version: noShow.version, status: 'SCHEDULED' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    });

    it('verrou optimiste : une version périmée est refusée', async () => {
      const a = await book(await newPatient(), '2026-10-02T16:00');
      await service.update(
        secretary,
        a.id,
        { version: a.version, note: 'Apporter la radio' },
        META,
      );
      await expect(
        service.changeStatus(secretary, a.id, { version: a.version, status: 'CANCELLED' }, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('modification', () => {
    it('déplacement : nouvelles règles appliquées, audit avant/après ; un rendez-vous annulé ne bouge plus', async () => {
      const a = await book(await newPatient(), '2026-10-05T09:00');
      const moved = await service.update(
        secretary,
        a.id,
        { version: a.version, start: '2026-10-05T11:00', durationMinutes: 45 },
        META,
      );
      expect(moved).toMatchObject({ startAt: '2026-10-05T09:00:00.000Z', durationMinutes: 45 });
      // Vers un autre praticien, hors de ses horaires : confirmation exigée.
      await expect(
        service.update(
          secretary,
          a.id,
          { version: moved.version, practitionerId: drB, start: '2026-10-05T13:00' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'AVAILABILITY_CONFIRMATION_REQUIRED' });
      const toB = await service.update(
        secretary,
        a.id,
        { version: moved.version, practitionerId: drB, start: '2026-10-05T14:00' },
        META,
      );
      expect(toB.practitionerId).toBe(drB);
      const updates = (await auditFor(a.id)).filter((e) => e.action === 'appointment.updated');
      expect(updates[1]?.changes).toMatchObject({
        practitionerId: { from: drA, to: drB },
        startAt: { from: '2026-10-05T09:00:00.000Z', to: '2026-10-05T12:00:00.000Z' },
      });
      const cancelled = await service.changeStatus(
        secretary,
        a.id,
        { version: toB.version, status: 'CANCELLED' },
        META,
      );
      await expect(
        service.update(secretary, a.id, { version: cancelled.version, durationMinutes: 30 }, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('une note seule ne redéclenche pas le contrôle des horaires', async () => {
      const a = await book(await newPatient(), '2026-10-05T12:30', {
        allowOutsideAvailability: true,
      });
      const noted = await service.update(
        secretary,
        a.id,
        { version: a.version, note: 'Rappeler la veille' },
        META,
      );
      expect(noted.note).toBe('Rappeler la veille');
    });
  });

  describe('liens avec les autres modules', () => {
    it('une indisponibilité posée sur des rendez-vous les liste sans les modifier', async () => {
      const a = await book(await newPatient(), '2026-10-08T09:00');
      const { conflicts } = await schedules.createBlock(
        dentist,
        {
          practitionerId: drA,
          kind: 'ABSENCE',
          allDay: true,
          startDate: '2026-10-08',
          endDate: '2026-10-08',
        },
        META,
      );
      expect(conflicts.map((c) => c.id)).toEqual([a.id]);
      expect((await service.get(secretary, a.id)).status).toBe('SCHEDULED');
    });

    it('des horaires modifiés listent les rendez-vous prévus désormais hors horaires', async () => {
      const wednesday = await book(await newPatient(), '2026-10-14T09:00', {
        practitionerId: drB,
      });
      const [current] = await schedules.listSchedules(admin, drB);
      const { conflicts } = await schedules.setSchedule(
        admin,
        drB,
        {
          validFrom: '2026-10-12',
          basePeriod: { id: current!.id, version: current!.version },
          intervals: WEEKDAYS.filter((i) => i.weekday !== 3),
        },
        META,
      );
      expect(conflicts.map((c) => c.id)).toContain(wednesday.id);
    });

    it('disponibilités et créneaux libres tiennent compte des rendez-vous et du passé', async () => {
      await book(await newPatient(), '2026-10-09T09:30');
      const availability = await schedules.availability(secretary, {
        from: '2026-10-09',
        to: '2026-10-09',
        practitionerId: drA,
      });
      expect(availability.practitioners[0]!.available[0]).toEqual({
        start: '2026-10-09T07:00:00.000Z',
        end: '2026-10-09T07:30:00.000Z',
      });
      const { slots } = await service.slots(secretary, {
        practitionerId: drA,
        from: '2026-10-09',
        to: '2026-10-09',
        durationMinutes: 45,
        step: 15,
      });
      // 9 h ne suffit plus (45 min avant 9 h 30) ; premier créneau : 10 h (fin du rendez-vous).
      expect(slots[0]).toBe('2026-10-09T08:00:00.000Z');
      expect(slots).not.toContain('2026-10-09T07:00:00.000Z');
      // Aujourd'hui : rien avant l'heure actuelle.
      const today = await service.slots(secretary, {
        practitionerId: drA,
        from: '2026-09-28',
        to: '2026-09-28',
        durationMinutes: 30,
      });
      expect(today.slots.every((s) => Date.parse(s) >= clock.now().getTime())).toBe(true);
    });

    it('archivage refusé pour un praticien ou un patient qui a des rendez-vous prévus', async () => {
      const patient = await patientsService.create(
        secretary,
        { lastName: 'Suivi', firstName: 'Lou', contacts: [] },
        META,
      );
      await book(patient.id, '2026-10-12T09:00');
      await expect(
        patientsService.archive(secretary, patient.id, patient.version, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      const list = await practitionersService.listPractitioners(admin, { includeArchived: false });
      const a = list.find((p) => p.id === drA)!;
      await expect(
        practitionersService.archivePractitioner(admin, drA, a.version, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('l’annulation d’un import ne supprime jamais un patient qui a un rendez-vous', async () => {
      const imports = createImportsService(deps);
      const batch = await imports.create(
        admin,
        { kind: 'PATIENTS', fileName: 'export.csv', totalRows: 2, dateFormat: 'DD/MM/YYYY' },
        META,
      );
      await imports.addRows(admin, batch.id, {
        rows: [
          { line: 2, lastName: 'Importe', firstName: 'Avec' },
          { line: 3, lastName: 'Importe', firstName: 'Sans' },
        ],
      });
      await imports.commit(admin, batch.id, META);
      const found = await patientsService.list(secretary, { q: 'importe avec' });
      await book(found.patients[0]!.id, '2026-10-13T09:00');
      expect(await imports.revert(admin, batch.id, META)).toMatchObject({ deleted: 1, kept: 1 });
    });
  });

  describe('permissions et isolation', () => {
    it('un autre cabinet ne voit ni ne modifie rien ; il ne peut pas utiliser ses patients', async () => {
      const a = await book(await newPatient(), '2026-10-02T15:00');
      expect(await service.list(otherAdmin, { from: '2026-09-28', to: '2026-10-30' })).toEqual([]);
      await expect(service.get(otherAdmin, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        service.changeStatus(otherAdmin, a.id, { version: a.version, status: 'CANCELLED' }, META),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        service.create(
          otherAdmin,
          {
            practitionerId: drA,
            patientId: a.patient.id,
            appointmentTypeId: consultation,
            start: '2026-10-02T15:00',
          },
          META,
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const [row] = await withTenant(t.appDb, clinic.id, (tx) =>
        tx
          .select({ status: appointments.status })
          .from(appointments)
          .where(and(eq(appointments.clinicId, clinic.id), eq(appointments.id, a.id))),
      );
      expect(row?.status).toBe('SCHEDULED');
    });
  });

  describe('rendez-vous dans le passé (ADR 0008)', () => {
    // Horloge propre à ces tests : mardi 29 septembre, 14 h 05 à Paris.
    const past = createAppointmentsService({
      db: t.appDb,
      now: () => new Date('2026-09-29T12:05:00Z'),
    });
    const bookAt = (patientId: string, start: string, extra: object = {}) =>
      past.create(
        secretary,
        { practitionerId: drA, patientId, appointmentTypeId: consultation, start, ...extra },
        META,
      );

    it('création : confirmation exigée avec la raison « dans le passé », puis tracée', async () => {
      const patient = await newPatient();
      // 14 h, dans les horaires : seule raison, le passé (même 5 minutes avant).
      await expect(bookAt(patient, '2026-09-29T14:00')).rejects.toMatchObject({
        code: 'AVAILABILITY_CONFIRMATION_REQUIRED',
        reasons: ['IN_PAST'],
        message: expect.stringContaining('dans le passé') as string,
      });
      // 13 h : dans le passé et hors horaires.
      await expect(bookAt(patient, '2026-09-29T13:00')).rejects.toMatchObject({
        reasons: ['IN_PAST', 'OUTSIDE_WORKING_HOURS'],
      });
      const forced = await bookAt(patient, '2026-09-29T14:00', { allowOutsideAvailability: true });
      const override = (await auditFor(forced.id)).find(
        (e) => e.action === 'appointment.availability_override',
      );
      expect(override?.changes).toMatchObject({ reasons: { to: 'IN_PAST' } });
      // À venir (14 h 30) : aucune confirmation.
      await bookAt(await newPatient(), '2026-09-29T14:30');
    });

    it('déplacement vers le passé : confirmation exigée ; absence passée : refus sans dérogation', async () => {
      const a = await bookAt(await newPatient(), '2026-09-29T16:00');
      await expect(
        past.update(secretary, a.id, { version: a.version, start: '2026-09-29T11:00' }, META),
      ).rejects.toMatchObject({ reasons: ['IN_PAST'] });
      const moved = await past.update(
        secretary,
        a.id,
        { version: a.version, start: '2026-09-29T11:00', allowOutsideAvailability: true },
        META,
      );
      expect(moved.startAt).toBe('2026-09-29T09:00:00.000Z');
      await schedules.createBlock(
        secretary,
        {
          practitionerId: drB,
          kind: 'ABSENCE',
          allDay: false,
          start: '2026-09-29T10:00',
          end: '2026-09-29T11:00',
          label: null,
        },
        META,
      );
      await expect(
        past.create(
          secretary,
          {
            practitionerId: drB,
            patientId: await newPatient(),
            appointmentTypeId: consultation,
            start: '2026-09-29T10:15',
            allowOutsideAvailability: true,
          },
          META,
        ),
      ).rejects.toMatchObject({ code: 'PRACTITIONER_ABSENT' });
    });
  });

  describe('idempotence de la création (réponse perdue, double envoi)', () => {
    const request = (patientId: string, start: string, key: string) => ({
      practitionerId: drA,
      patientId,
      appointmentTypeId: consultation,
      start,
      idempotencyKey: key,
    });
    const rowsWithKey = (key: string) =>
      withTenant(t.appDb, clinic.id, (tx) =>
        tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(and(eq(appointments.clinicId, clinic.id), eq(appointments.idempotencyKey, key))),
      );

    it('nouvel essai avec la même clé : même rendez-vous, aucune seconde ligne ni trace', async () => {
      const key = randomUUID();
      const patient = await newPatient();
      const first = await service.createOrReplay(
        secretary,
        request(patient, '2026-10-19T09:00', key),
        META,
      );
      const again = await service.createOrReplay(
        secretary,
        request(patient, '2026-10-19T09:00', key),
        META,
      );
      expect(first.replayed).toBe(false);
      expect(again).toEqual({ appointment: first.appointment, replayed: true });
      expect(await rowsWithKey(key)).toHaveLength(1);
      expect((await auditFor(first.appointment.id)).map((a) => a.action)).toEqual([
        'appointment.created',
      ]);
    });

    it('cinq envois simultanés de la même saisie : un seul rendez-vous, tous le reçoivent', async () => {
      const key = randomUUID();
      const patient = await newPatient();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.createOrReplay(secretary, request(patient, '2026-10-19T10:00', key), META),
        ),
      );
      expect(new Set(results.map((r) => r.appointment.id)).size).toBe(1);
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      expect(await rowsWithKey(key)).toHaveLength(1);
    });

    it('même clé avec une autre demande : refus explicite, rien de créé', async () => {
      const key = randomUUID();
      const patient = await newPatient();
      await service.createOrReplay(secretary, request(patient, '2026-10-19T11:00', key), META);
      await expect(
        service.createOrReplay(secretary, request(patient, '2026-10-19T14:00', key), META),
      ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
      // Autre praticien, même clé : la clé déjà prise est détectée à l'insertion.
      await expect(
        service.createOrReplay(
          secretary,
          { ...request(await newPatient(), '2026-10-19T14:00', key), practitionerId: drB },
          META,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await rowsWithKey(key)).toHaveLength(1);
    });

    it('nouvelle demande légitime (nouvelle clé) : contrôlée normalement', async () => {
      const patient = await newPatient();
      await service.createOrReplay(
        secretary,
        request(patient, '2026-10-20T09:00', randomUUID()),
        META,
      );
      // Même créneau, nouvelle clé : c'est une nouvelle demande, refusée car le créneau est pris.
      await expect(
        service.createOrReplay(
          secretary,
          request(await newPatient(), '2026-10-20T09:00', randomUUID()),
          META,
        ),
      ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
      // Autre créneau, nouvelle clé : créé.
      const other = await service.createOrReplay(
        secretary,
        request(patient, '2026-10-20T10:00', randomUUID()),
        META,
      );
      expect(other.replayed).toBe(false);
    });

    it('rendez-vous annulé puis même clé rejouée : le rendez-vous annulé est renvoyé, pas recréé', async () => {
      const key = randomUUID();
      const patient = await newPatient();
      const { appointment } = await service.createOrReplay(
        secretary,
        request(patient, '2026-10-20T11:00', key),
        META,
      );
      await service.changeStatus(
        secretary,
        appointment.id,
        { version: appointment.version, status: 'CANCELLED' },
        META,
      );
      const replay = await service.createOrReplay(
        secretary,
        request(patient, '2026-10-20T11:00', key),
        META,
      );
      expect(replay).toMatchObject({
        replayed: true,
        appointment: { id: appointment.id, status: 'CANCELLED' },
      });
      expect(await rowsWithKey(key)).toHaveLength(1);
    });

    it('clé propre à chaque cabinet : la même clé dans un autre cabinet crée son rendez-vous', async () => {
      const key = randomUUID();
      const mine = await service.createOrReplay(
        secretary,
        request(await newPatient(), '2026-10-21T09:00', key),
        META,
      );
      // Autre cabinet, même clé : aucune ligne visible (RLS), aucun refus qui révélerait la
      // clé du premier cabinet ; son propre rendez-vous est créé.
      const practitioner = await practitionersService.createPractitioner(
        otherAdmin,
        { displayName: 'Dr Ailleurs', color: '#0ea5e9' },
        META,
      );
      const type = await practitionersService.createType(
        otherAdmin,
        { name: 'Consultation', durationMinutes: 30, color: '#0ea5e9' },
        META,
      );
      const patient = await patientsService.create(
        otherAdmin,
        { lastName: 'Ailleurs', firstName: 'Nina', contacts: [] },
        META,
      );
      const theirs = await service.createOrReplay(
        otherAdmin,
        {
          practitionerId: practitioner.id,
          patientId: patient.id,
          appointmentTypeId: type.id,
          start: '2026-10-21T09:00',
          allowOutsideAvailability: true,
          idempotencyKey: key,
        },
        META,
      );
      expect(theirs.replayed).toBe(false);
      expect(theirs.appointment.id).not.toBe(mine.appointment.id);
      expect(await rowsWithKey(key)).toEqual([{ id: mine.appointment.id }]);
    });
  });
});
