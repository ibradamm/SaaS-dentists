import { describe, expect, it } from 'vitest';
import {
  createAppointmentTypeRequestSchema,
  createBlockRequestSchema,
  createPractitionerRequestSchema,
  minutesToTime,
  setScheduleRequestSchema,
  timeToMinutes,
  weeklyIntervalSchema,
} from './scheduling';

describe('heures locales', () => {
  it('convertit HH:mm et minutes dans les deux sens, 24:00 compris', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(minutesToTime(570)).toBe('09:30');
    expect(minutesToTime(1440)).toBe('24:00');
    for (const bad of ['9:30', '24:05', '12:60', '1200']) {
      expect(() => timeToMinutes(bad)).toThrow();
    }
  });
});

describe('horaires hebdomadaires', () => {
  it('plage valide : fin après début, grille de 5 minutes, jour ISO', () => {
    expect(
      weeklyIntervalSchema.safeParse({ weekday: 1, start: '09:00', end: '12:00' }).success,
    ).toBe(true);
    expect(
      weeklyIntervalSchema.safeParse({ weekday: 7, start: '14:00', end: '24:00' }).success,
    ).toBe(true);
    for (const bad of [
      { weekday: 1, start: '12:00', end: '09:00' },
      { weekday: 1, start: '09:00', end: '09:00' },
      { weekday: 1, start: '09:02', end: '10:00' },
      { weekday: 0, start: '09:00', end: '10:00' },
      { weekday: 8, start: '09:00', end: '10:00' },
    ]) {
      expect(weeklyIntervalSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('refuse deux plages du même jour qui se chevauchent, accepte les plages adjacentes', () => {
    const base = { validFrom: '2026-10-01', basePeriod: null };
    expect(
      setScheduleRequestSchema.safeParse({
        ...base,
        intervals: [
          { weekday: 1, start: '09:00', end: '12:00' },
          { weekday: 1, start: '12:00', end: '14:00' },
          { weekday: 2, start: '10:00', end: '11:00' },
        ],
      }).success,
    ).toBe(true);
    expect(
      setScheduleRequestSchema.safeParse({
        ...base,
        intervals: [
          { weekday: 1, start: '14:00', end: '18:00' },
          { weekday: 1, start: '09:00', end: '14:30' },
        ],
      }).success,
    ).toBe(false);
    expect(setScheduleRequestSchema.safeParse({ ...base, intervals: [] }).success).toBe(true);
  });
});

describe('indisponibilités', () => {
  it('journées entières ou heures locales, sur la grille de 5 minutes', () => {
    const allDay = createBlockRequestSchema.parse({
      practitionerId: null,
      kind: 'ABSENCE',
      allDay: true,
      startDate: '2026-12-24',
      endDate: '2026-12-31',
    });
    expect(allDay).toMatchObject({ allDay: true, label: null, practitionerId: null });
    expect(
      createBlockRequestSchema.safeParse({
        practitionerId: '01a0de00-0000-7000-8000-000000000001',
        kind: 'BLOCK',
        allDay: false,
        start: '2026-10-01T12:00',
        end: '2026-10-01T13:30',
        label: 'Réunion',
      }).success,
    ).toBe(true);
    expect(
      createBlockRequestSchema.safeParse({
        practitionerId: null,
        kind: 'BLOCK',
        allDay: false,
        start: '2026-10-01T12:03',
        end: '2026-10-01T13:00',
      }).success,
    ).toBe(false);
    // Forme mélangée refusée : journée entière avec des heures.
    expect(
      createBlockRequestSchema.safeParse({
        practitionerId: null,
        kind: 'ABSENCE',
        allDay: true,
        start: '2026-10-01T12:00',
        end: '2026-10-01T13:00',
      }).success,
    ).toBe(false);
  });
});

describe('praticiens et types', () => {
  it('couleur normalisée en minuscules ; durée sur la grille, de 5 à 480 minutes', () => {
    expect(
      createPractitionerRequestSchema.parse({ displayName: ' Dr Martin ', color: '#0EA5E9' }),
    ).toEqual({ displayName: 'Dr Martin', color: '#0ea5e9', userId: null });
    expect(
      createPractitionerRequestSchema.safeParse({ displayName: 'X', color: 'blue' }).success,
    ).toBe(false);
    for (const [duration, ok] of [
      [30, true],
      [5, true],
      [480, true],
      [0, false],
      [485, false],
      [32, false],
    ] as const) {
      expect(
        createAppointmentTypeRequestSchema.safeParse({
          name: 'Détartrage',
          durationMinutes: duration,
          color: '#10b981',
        }).success,
      ).toBe(ok);
    }
  });
});
