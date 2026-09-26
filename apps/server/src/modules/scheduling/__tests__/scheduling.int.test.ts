import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser, testClock } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import { auditLogs, type Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import type { UserActor } from '../../auth/auth.types';
import { createClinicService } from '../../clinic/clinic.service';
import { createPractitionersService } from '../practitioners.service';
import { createSchedulesService } from '../schedules.service';

const WEEKDAYS = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start: '09:00', end: '12:00' },
  { weekday, start: '14:00', end: '18:00' },
]);

describe('praticiens, horaires, indisponibilités et disponibilités', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  // Samedi 26 septembre 2026, 12 h à Paris.
  const clock = testClock(new Date('2026-09-26T10:00:00Z'));
  const practitionersService = createPractitionersService({ db: t.appDb, now: clock.now });
  const schedules = createSchedulesService({ db: t.appDb, now: clock.now });
  const clinicService = createClinicService({ db: t.appDb });

  let clinic: Clinic;
  let other: Clinic;
  let admin: UserActor;
  let secretary: UserActor;
  let dentistA: UserActor;
  let dentistB: UserActor;
  let otherAdmin: UserActor;
  let practitionerA: string;
  let practitionerB: string;

  const actor = async (c: Clinic, role: 'ADMIN' | 'DENTIST' | 'SECRETARY') =>
    actorFor((await createUser(t.ownerDb, c.id, role)).id, role, c.id);

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    other = await createTestClinic(t.ownerDb);
    admin = await actor(clinic, 'ADMIN');
    secretary = await actor(clinic, 'SECRETARY');
    dentistA = await actor(clinic, 'DENTIST');
    dentistB = await actor(clinic, 'DENTIST');
    otherAdmin = await actor(other, 'ADMIN');
    practitionerA = (
      await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr Alpha', color: '#0EA5E9', userId: dentistA.userId },
        META,
      )
    ).id;
    practitionerB = (
      await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr Bravo', color: '#10b981', userId: dentistB.userId },
        META,
      )
    ).id;
  });
  afterAll(() => t.close());

  describe('praticiens', () => {
    it('lien avec un compte du cabinet, affiché avec son nom ; couleur normalisée', async () => {
      const list = await practitionersService.listPractitioners(secretary, {
        includeArchived: false,
      });
      expect(list.find((p) => p.id === practitionerA)).toMatchObject({
        displayName: 'Dr Alpha',
        color: '#0ea5e9',
        userId: dentistA.userId,
        userFullName: expect.any(String) as string,
        status: 'ACTIVE',
        version: 1,
      });
    });

    it('un compte ne peut être lié qu’à un praticien, et seulement s’il est membre du cabinet', async () => {
      await expect(
        practitionersService.createPractitioner(
          admin,
          { displayName: 'Doublon', color: '#000000', userId: dentistA.userId },
          META,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        practitionersService.createPractitioner(
          admin,
          { displayName: 'Étranger', color: '#000000', userId: otherAdmin.userId },
          META,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const unlinked = await practitionersService.createPractitioner(
        admin,
        { displayName: 'Hygiéniste', color: '#f59e0b' },
        META,
      );
      expect(unlinked).toMatchObject({ userId: null, userFullName: null });
    });

    it('seul l’administrateur gère les praticiens ; verrou optimiste ; archivage', async () => {
      for (const who of [secretary, dentistA]) {
        await expect(
          practitionersService.createPractitioner(
            who,
            { displayName: 'X', color: '#000000' },
            META,
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      const p = await practitionersService.createPractitioner(
        admin,
        { displayName: 'Temporaire', color: '#123456' },
        META,
      );
      const renamed = await practitionersService.updatePractitioner(
        admin,
        p.id,
        { version: 1, displayName: 'Dr Temporaire' },
        META,
      );
      expect(renamed.version).toBe(2);
      await expect(
        practitionersService.updatePractitioner(
          admin,
          p.id,
          { version: 1, color: '#654321' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await practitionersService.archivePractitioner(admin, p.id, 2, META);
      const active = await practitionersService.listPractitioners(admin, {
        includeArchived: false,
      });
      const all = await practitionersService.listPractitioners(admin, { includeArchived: true });
      expect(active.some((x) => x.id === p.id)).toBe(false);
      expect(all.find((x) => x.id === p.id)?.status).toBe('ARCHIVED');
      // Agenda d'un praticien archivé non modifiable.
      await expect(
        schedules.setSchedule(
          admin,
          p.id,
          { validFrom: '2026-09-28', basePeriod: null, intervals: [] },
          META,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('types de rendez-vous', () => {
    it('nom unique parmi les types actifs, sans tenir compte de la casse', async () => {
      const type = await practitionersService.createType(
        admin,
        { name: 'Détartrage', durationMinutes: 30, color: '#10B981' },
        META,
      );
      await expect(
        practitionersService.createType(
          admin,
          { name: 'DÉTARTRAGE', durationMinutes: 45, color: '#10b981' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await practitionersService.archiveType(admin, type.id, type.version, META);
      const again = await practitionersService.createType(
        admin,
        { name: 'détartrage', durationMinutes: 45, color: '#10b981' },
        META,
      );
      // Restaurer l'ancien créerait un doublon actif.
      await expect(
        practitionersService.restoreType(admin, type.id, type.version + 1, META),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(
        (await practitionersService.listTypes(secretary, { includeArchived: false })).map(
          (x) => x.id,
        ),
      ).toContain(again.id);
      await expect(
        practitionersService.createType(
          dentistA,
          { name: 'Urgence', durationMinutes: 20, color: '#ef4444' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('horaires', () => {
    it('le dentiste gère ses horaires, pas ceux d’un confrère ; la secrétaire gère tous les agendas', async () => {
      const periods = await schedules.setSchedule(
        dentistA,
        practitionerA,
        { validFrom: '2026-09-26', basePeriod: null, intervals: WEEKDAYS },
        META,
      );
      expect(periods).toEqual([
        expect.objectContaining({ validFrom: '2026-09-26', validTo: null, version: 1 }),
      ]);
      expect(periods[0]!.intervals).toHaveLength(10);
      expect(periods[0]!.intervals[0]).toEqual({ weekday: 1, start: '09:00', end: '12:00' });

      await expect(
        schedules.setSchedule(
          dentistA,
          practitionerB,
          { validFrom: '2026-09-26', basePeriod: null, intervals: WEEKDAYS },
          META,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await schedules.setSchedule(
        secretary,
        practitionerB,
        { validFrom: '2026-09-26', basePeriod: null, intervals: WEEKDAYS.slice(0, 4) },
        META,
      );
    });

    it('changement daté : la période en cours s’arrête, les périodes futures sont conservées', async () => {
      const [current] = await schedules.listSchedules(secretary, practitionerA);
      // À partir du 2 novembre : plus de mercredi.
      const noWednesday = WEEKDAYS.filter((i) => i.weekday !== 3);
      let periods = await schedules.setSchedule(
        dentistA,
        practitionerA,
        {
          validFrom: '2026-11-02',
          basePeriod: { id: current!.id, version: current!.version },
          intervals: noWednesday,
        },
        META,
      );
      expect(periods.map((p) => [p.validFrom, p.validTo])).toEqual([
        ['2026-09-26', '2026-11-02'],
        ['2026-11-02', null],
      ]);
      // Changement intermédiaire du 12 octobre : s'insère jusqu'au 2 novembre.
      periods = await schedules.setSchedule(
        dentistA,
        practitionerA,
        {
          validFrom: '2026-10-12',
          basePeriod: { id: periods[0]!.id, version: periods[0]!.version },
          intervals: [{ weekday: 1, start: '08:00', end: '12:00' }],
        },
        META,
      );
      expect(periods.map((p) => [p.validFrom, p.validTo])).toEqual([
        ['2026-09-26', '2026-10-12'],
        ['2026-10-12', '2026-11-02'],
        ['2026-11-02', null],
      ]);
      // Même date : les plages de la période sont remplacées.
      const oct = periods[1]!;
      periods = await schedules.setSchedule(
        dentistA,
        practitionerA,
        {
          validFrom: '2026-10-12',
          basePeriod: { id: oct.id, version: oct.version },
          intervals: [{ weekday: 2, start: '08:00', end: '12:00' }],
        },
        META,
      );
      expect(periods[1]).toMatchObject({
        id: oct.id,
        version: oct.version + 1,
        intervals: [{ weekday: 2, start: '08:00', end: '12:00' }],
      });
      // Suppression de la période future : la précédente la recouvre.
      periods = await schedules.deletePeriod(
        dentistA,
        practitionerA,
        periods[1]!.id,
        periods[1]!.version,
        META,
      );
      expect(periods.map((p) => [p.validFrom, p.validTo])).toEqual([
        ['2026-09-26', '2026-11-02'],
        ['2026-11-02', null],
      ]);
    });

    it('refuse une date passée, une version périmée, la suppression d’une période commencée', async () => {
      const periods = await schedules.listSchedules(admin, practitionerA);
      await expect(
        schedules.setSchedule(
          admin,
          practitionerA,
          { validFrom: '2026-09-25', basePeriod: null, intervals: [] },
          META,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        schedules.setSchedule(
          admin,
          practitionerA,
          {
            validFrom: '2026-10-05',
            basePeriod: { id: periods[0]!.id, version: periods[0]!.version + 7 },
            intervals: [],
          },
          META,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        schedules.deletePeriod(admin, practitionerA, periods[0]!.id, periods[0]!.version, META),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('deux modifications simultanées : une réussit, l’autre reçoit un conflit', async () => {
      const [current] = await schedules.listSchedules(admin, practitionerB);
      const attempt = (who: UserActor, start: string) =>
        schedules.setSchedule(
          who,
          practitionerB,
          {
            validFrom: '2026-10-19',
            basePeriod: { id: current!.id, version: current!.version },
            intervals: [{ weekday: 1, start, end: '12:00' }],
          },
          META,
        );
      const results = await Promise.allSettled([
        attempt(admin, '08:00'),
        attempt(secretary, '10:00'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
      const after = await schedules.listSchedules(admin, practitionerB);
      expect(after.map((p) => p.validFrom)).toEqual(['2026-09-26', '2026-10-19']);
    });

    it('remplacements simultanés d’une même période : jamais de mélange des deux saisies', async () => {
      const periods = await schedules.listSchedules(admin, practitionerB);
      const target = periods.find((p) => p.validFrom === '2026-10-19')!;
      const attempt = (who: UserActor, weekday: number) =>
        schedules.setSchedule(
          who,
          practitionerB,
          {
            validFrom: '2026-10-19',
            basePeriod: { id: target.id, version: target.version },
            intervals: [
              { weekday, start: '08:00', end: '12:00' },
              { weekday, start: '13:00', end: '17:00' },
            ],
          },
          META,
        );
      const results = await Promise.allSettled([attempt(admin, 3), attempt(secretary, 4)]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const after = (await schedules.listSchedules(admin, practitionerB)).find(
        (p) => p.id === target.id,
      )!;
      expect(new Set(after.intervals.map((i) => i.weekday)).size).toBe(1);
      expect(after.intervals).toHaveLength(2);
    });
  });

  describe('indisponibilités', () => {
    it('saisie en heure locale convertie en UTC ; heure inexistante refusée', async () => {
      const block = await schedules.createBlock(
        dentistA,
        {
          practitionerId: practitionerA,
          kind: 'BLOCK',
          allDay: false,
          start: '2026-09-28T10:00',
          end: '2026-09-28T11:00',
          label: 'Réunion fournisseur',
        },
        META,
      );
      expect(block).toMatchObject({
        startAt: '2026-09-28T08:00:00.000Z',
        endAt: '2026-09-28T09:00:00.000Z',
        allDay: false,
        version: 1,
      });
      await expect(
        schedules.createBlock(
          dentistA,
          {
            practitionerId: practitionerA,
            kind: 'BLOCK',
            allDay: false,
            start: '2027-03-28T02:30',
            end: '2027-03-28T04:00',
          },
          META,
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        message: expect.stringContaining("changement d'heure") as string,
      });
      // Le libellé (texte libre) n'est pas recopié dans l'audit.
      const [entry] = await withTenant(t.appDb, clinic.id, (tx) =>
        tx
          .select({ changes: auditLogs.changes })
          .from(auditLogs)
          .where(eq(auditLogs.entityId, block.id)),
      );
      expect(JSON.stringify(entry?.changes)).not.toContain('fournisseur');
    });

    it('journées entières de part et d’autre du changement d’heure', async () => {
      const block = await schedules.createBlock(
        secretary,
        {
          practitionerId: practitionerB,
          kind: 'ABSENCE',
          allDay: true,
          startDate: '2026-10-24',
          endDate: '2026-10-26',
          label: 'Congés',
        },
        META,
      );
      // Du 24 à 0 h (UTC+2) au 27 à 0 h (UTC+1).
      expect(block).toMatchObject({
        startAt: '2026-10-23T22:00:00.000Z',
        endAt: '2026-10-26T23:00:00.000Z',
        allDay: true,
      });
    });

    it('portée : le dentiste ne gère que son agenda ; tout le cabinet réservé au secrétariat et à l’administrateur', async () => {
      const closure = {
        practitionerId: null,
        kind: 'ABSENCE' as const,
        allDay: true as const,
        startDate: '2026-09-30',
        endDate: '2026-09-30',
        label: 'Cabinet fermé',
      };
      await expect(schedules.createBlock(dentistA, closure, META)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        schedules.createBlock(dentistA, { ...closure, practitionerId: practitionerB }, META),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      const created = await schedules.createBlock(secretary, closure, META);
      expect(created.practitionerId).toBeNull();
      // Le dentiste ne peut ni modifier ni supprimer une fermeture du cabinet.
      await expect(
        schedules.deleteBlock(dentistA, created.id, created.version, META),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('modification avec verrou optimiste, puis suppression', async () => {
      const block = await schedules.createBlock(
        dentistA,
        {
          practitionerId: practitionerA,
          kind: 'BLOCK',
          allDay: false,
          start: '2026-10-06T16:00',
          end: '2026-10-06T17:00',
        },
        META,
      );
      const moved = await schedules.replaceBlock(
        dentistA,
        block.id,
        {
          version: 1,
          kind: 'ABSENCE',
          allDay: false,
          start: '2026-10-06T15:00',
          end: '2026-10-06T18:00',
        },
        META,
      );
      expect(moved).toMatchObject({
        kind: 'ABSENCE',
        version: 2,
        startAt: '2026-10-06T13:00:00.000Z',
      });
      await expect(
        schedules.replaceBlock(
          dentistA,
          block.id,
          {
            version: 1,
            kind: 'BLOCK',
            allDay: true,
            startDate: '2026-10-06',
            endDate: '2026-10-06',
          },
          META,
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(schedules.deleteBlock(dentistB, block.id, 2, META)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await schedules.deleteBlock(dentistA, block.id, 2, META);
      const listed = await schedules.listBlocks(admin, { from: '2026-10-06', to: '2026-10-06' });
      expect(listed.some((b) => b.id === block.id)).toBe(false);
    });

    it('liste par période et par praticien, fermetures du cabinet comprises', async () => {
      const forA = await schedules.listBlocks(admin, {
        from: '2026-09-28',
        to: '2026-10-04',
        practitionerId: practitionerA,
      });
      expect(forA.map((b) => [b.practitionerId === null ? 'cabinet' : 'A', b.kind])).toEqual([
        ['A', 'BLOCK'],
        ['cabinet', 'ABSENCE'],
      ]);
      await expect(
        schedules.listBlocks(admin, { from: '2026-01-01', to: '2027-06-01' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('disponibilités', () => {
    it('horaires moins blocages, absences et fermetures du cabinet', async () => {
      const result = await schedules.availability(dentistB, {
        from: '2026-09-28',
        to: '2026-10-02',
        practitionerId: practitionerA,
      });
      expect(result.timezone).toBe('Europe/Paris');
      const [a] = result.practitioners;
      // Lundi 28 : 9-10, 11-12, 14-18 (blocage 10-11). Mercredi 30 : fermé.
      const byDay = (list: { start: string; end: string }[]) =>
        list.map((i) => `${i.start.slice(5, 16)}→${i.end.slice(11, 16)}`);
      expect(byDay(a!.available).filter((s) => s.startsWith('09-28'))).toEqual([
        '09-28T07:00→08:00',
        '09-28T09:00→10:00',
        '09-28T12:00→16:00',
      ]);
      expect(byDay(a!.available).some((s) => s.startsWith('09-30'))).toBe(false);
      expect(byDay(a!.working).filter((s) => s.startsWith('09-30'))).toHaveLength(2);
      expect(result.blocks.map((b) => b.kind)).toEqual(['BLOCK', 'ABSENCE']);
    });

    it('sans praticien précisé : tous les praticiens actifs ; période limitée à 62 jours', async () => {
      const result = await schedules.availability(secretary, {
        from: '2026-09-28',
        to: '2026-09-28',
      });
      expect(result.practitioners.map((p) => p.practitionerId)).toEqual(
        expect.arrayContaining([practitionerA, practitionerB]),
      );
      await expect(
        schedules.availability(secretary, { from: '2026-09-01', to: '2026-11-15' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('isolation entre cabinets', () => {
    it('un autre cabinet ne voit ni ne modifie rien de ce cabinet', async () => {
      expect(
        await practitionersService.listPractitioners(otherAdmin, { includeArchived: true }),
      ).toEqual([]);
      const attempts = [
        () => schedules.listSchedules(otherAdmin, practitionerA),
        () =>
          schedules.setSchedule(
            otherAdmin,
            practitionerA,
            { validFrom: '2026-10-01', basePeriod: null, intervals: [] },
            META,
          ),
        () =>
          schedules.createBlock(
            otherAdmin,
            {
              practitionerId: practitionerA,
              kind: 'ABSENCE',
              allDay: true,
              startDate: '2026-10-01',
              endDate: '2026-10-01',
            },
            META,
          ),
        () =>
          schedules.availability(otherAdmin, {
            from: '2026-10-01',
            to: '2026-10-01',
            practitionerId: practitionerA,
          }),
        () =>
          practitionersService.updatePractitioner(
            otherAdmin,
            practitionerA,
            { version: 1, displayName: 'Pirate' },
            META,
          ),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      expect(
        (await schedules.listBlocks(otherAdmin, { from: '2026-09-01', to: '2026-12-31' })).length,
      ).toBe(0);
    });
  });

  describe('profil et fuseau du cabinet', () => {
    it('coordonnées normalisées ; changement de fuseau : journées entières recalées', async () => {
      const updated = await clinicService.update(
        admin,
        {
          addressLine1: '12 rue de la Paix',
          city: 'Paris',
          phone: '01 45 67 89 10',
          email: 'Accueil@Cabinet.fr',
        },
        META,
      );
      expect(updated).toMatchObject({
        phone: '+33145678910',
        email: 'accueil@cabinet.fr',
        city: 'Paris',
      });

      const [before] = await schedules.listBlocks(admin, {
        from: '2026-10-24',
        to: '2026-10-26',
        practitionerId: practitionerB,
      });
      await clinicService.update(admin, { timezone: 'America/Martinique' }, META);
      const [after] = await schedules.listBlocks(admin, {
        from: '2026-10-24',
        to: '2026-10-26',
        practitionerId: practitionerB,
      });
      // Mêmes dates locales (24 au 26 octobre), minuits de la Martinique (UTC-4).
      expect(after).toMatchObject({
        id: before!.id,
        startAt: '2026-10-24T04:00:00.000Z',
        endAt: '2026-10-27T04:00:00.000Z',
        version: before!.version + 1,
      });
      // Les indisponibilités horaires gardent leurs instants.
      const [timed] = await schedules.listBlocks(admin, {
        from: '2026-09-28',
        to: '2026-09-28',
        practitionerId: practitionerA,
      });
      expect(timed?.startAt).toBe('2026-09-28T08:00:00.000Z');
      await clinicService.update(admin, { timezone: 'Europe/Paris' }, META);

      const entries = await withTenant(t.appDb, clinic.id, (tx) =>
        tx
          .select({ changes: auditLogs.changes })
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.entityId, clinic.id),
              inArray(auditLogs.action, ['clinic.settings_update']),
            ),
          ),
      );
      const serialized = JSON.stringify(entries);
      expect(serialized).toContain('allDayBlocksReanchored');
      expect(serialized).not.toContain('rue de la Paix');
    });
  });
});
