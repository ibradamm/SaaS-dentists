import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_STATUSES,
  createAppointmentRequestSchema,
  findTransition,
  updateAppointmentRequestSchema,
  type AppointmentStatus,
} from './appointments';

describe('transitions de statut', () => {
  // Attendu écrit indépendamment de la table du code : toute modification doit être voulue.
  // « * » : seulement une fois l'heure de début passée.
  const expected: Record<AppointmentStatus, Partial<Record<AppointmentStatus, 'oui' | '*'>>> = {
    SCHEDULED: { COMPLETED: '*', NO_SHOW: '*', CANCELLED: 'oui' },
    COMPLETED: { SCHEDULED: 'oui' },
    NO_SHOW: { SCHEDULED: 'oui' },
    CANCELLED: {},
  };

  it.each(APPOINTMENT_STATUSES)('depuis %s', (from) => {
    for (const to of APPOINTMENT_STATUSES) {
      const transition = findTransition(from, to);
      const actual = transition ? (transition.requiresStarted ? '*' : 'oui') : undefined;
      expect({ from, to, actual }).toEqual({ from, to, actual: expected[from][to] });
    }
  });

  it('« annulé » est définitif', () => {
    for (const to of APPOINTMENT_STATUSES) expect(findTransition('CANCELLED', to)).toBeUndefined();
  });
});

describe('saisie d’un rendez-vous', () => {
  const base = {
    practitionerId: '01a0de00-0000-7000-8000-000000000001',
    patientId: '01a0de00-0000-7000-8000-000000000002',
    appointmentTypeId: '01a0de00-0000-7000-8000-000000000003',
    start: '2026-10-01T10:00',
  };

  it('durée facultative (type par défaut), sur la grille, de 5 min à 8 h ; confirmation absente par défaut', () => {
    expect(createAppointmentRequestSchema.parse(base)).toEqual({
      ...base,
      note: null,
      allowOutsideAvailability: false,
    });
    for (const [durationMinutes, ok] of [
      [45, true],
      [5, true],
      [480, true],
      [0, false],
      [485, false],
      [42, false],
    ] as const) {
      expect(createAppointmentRequestSchema.safeParse({ ...base, durationMinutes }).success).toBe(
        ok,
      );
    }
    expect(
      createAppointmentRequestSchema.safeParse({ ...base, start: '2026-10-01T10:02' }).success,
    ).toBe(false);
  });

  it('une modification doit changer quelque chose (la confirmation seule ne suffit pas)', () => {
    expect(
      updateAppointmentRequestSchema.safeParse({ version: 1, allowOutsideAvailability: true })
        .success,
    ).toBe(false);
    expect(
      updateAppointmentRequestSchema.safeParse({ version: 1, durationMinutes: 60 }).success,
    ).toBe(true);
  });
});
