import type {
  Appointment,
  AppointmentType,
  AvailabilityResponse,
  ClinicResponse,
  DashboardResponse,
  PatientDetail,
  Practitioner,
} from '@dental/shared';

/** Données de test communes (identifiants fixes, cabinet à Paris). */
export const IDS = {
  me: '01a0de00-0000-7000-8000-000000000001',
  alpha: '01a0de00-0000-7000-8000-0000000000a1',
  bravo: '01a0de00-0000-7000-8000-0000000000b2',
  consult: '01a0de00-0000-7000-8000-0000000000d1',
  patient: '01a0de00-0000-7000-8000-00000000a001',
} as const;

export function clinic(overrides: Partial<ClinicResponse> = {}): ClinicResponse {
  return {
    id: '01a0de00-0000-7000-8000-0000000000c1',
    name: 'Cabinet du Parc',
    timezone: 'Europe/Paris',
    locale: 'fr-FR',
    currency: 'EUR',
    countryCode: 'FR',
    addressLine1: '1 rue du Parc',
    addressLine2: null,
    postalCode: '75001',
    city: 'Paris',
    phone: '+33145678910',
    email: null,
    ...overrides,
  };
}

export const practitioner = (
  id: string,
  displayName: string,
  userId: string | null = null,
): Practitioner => ({
  id,
  displayName,
  color: '#0ea5e9',
  userId,
  userFullName: userId ? 'Camille Martin' : null,
  status: 'ACTIVE',
  version: 1,
});

export const consultation: AppointmentType = {
  id: IDS.consult,
  name: 'Consultation',
  durationMinutes: 30,
  color: '#10b981',
  status: 'ACTIVE',
  version: 1,
};

export function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: '01a0de00-0000-7000-8000-00000000f001',
    practitionerId: IDS.alpha,
    patient: { id: IDS.patient, lastName: 'Dupont', firstName: 'Léa', primaryPhone: null },
    appointmentType: { id: IDS.consult, name: 'Consultation', color: '#10b981' },
    startAt: '2026-09-28T07:00:00.000Z',
    endAt: '2026-09-28T07:30:00.000Z',
    durationMinutes: 30,
    status: 'SCHEDULED',
    note: null,
    cancellationReason: null,
    billingExempt: false,
    version: 1,
    ...overrides,
  };
}

export function patientDetail(overrides: Partial<PatientDetail> = {}): PatientDetail {
  return {
    id: IDS.patient,
    lastName: 'Dupont',
    firstName: 'Léa',
    birthDate: '1985-03-12',
    primaryPhone: '+33612345678',
    status: 'ACTIVE',
    email: null,
    administrativeNote: null,
    createdSource: 'STAFF',
    externalRef: null,
    version: 1,
    contacts: [
      {
        id: '01a0de00-0000-7000-8000-00000000c001',
        phone: '+33612345678',
        relationship: 'SELF',
        label: null,
        isPrimary: true,
      },
    ],
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

/** Disponibilités : 9 h-18 h (heure de Paris) le lundi 28 septembre pour chaque praticien. */
export function availability(practitionerIds: string[]): AvailabilityResponse {
  const working = [{ start: '2026-09-28T07:00:00.000Z', end: '2026-09-28T16:00:00.000Z' }];
  return {
    timezone: 'Europe/Paris',
    from: '2026-09-28',
    to: '2026-10-11',
    practitioners: practitionerIds.map((practitionerId) => ({
      practitionerId,
      working,
      available: working,
    })),
    blocks: [],
  };
}

/**
 * Réponse du tableau de bord pour septembre 2026 (ou la période donnée), sections selon le
 * rôle comme le fait le serveur : pas de revenus pour la secrétaire.
 */
export function dashboard(
  role: 'ADMIN' | 'DENTIST' | 'SECRETARY',
  period: { from: string; to: string } = { from: '2026-09-01', to: '2026-09-30' },
): DashboardResponse {
  const starts = ['2026-09-01', '2026-09-02', '2026-09-03'];
  return {
    from: period.from,
    to: period.to,
    previous: { from: '2026-08-01', to: '2026-08-31' },
    granularity: 'day',
    timezone: 'Europe/Paris',
    currency: 'EUR',
    practitionerId: null,
    activity: {
      total: 9,
      scheduled: 2,
      completed: 6,
      noShow: 1,
      cancelled: 1,
      noShowRate: 1 / 7,
      presenceRate: 6 / 7,
      cancellationRate: 0.1,
      patientsSeen: 4,
      previousCompleted: 3,
      upcomingNext7Days: 5,
      occupancy: { bookedMinutes: 195, openMinutes: 4740, rate: 195 / 4740 },
      byPractitioner: [
        {
          practitionerId: IDS.alpha,
          displayName: 'Dr Alpha',
          color: '#0ea5e9',
          total: 6,
          completed: 4,
          noShow: 1,
          cancelled: 1,
          presenceRate: 0.8,
          bookedMinutes: 105,
          openMinutes: 3780,
          rate: 105 / 3780,
        },
        {
          practitionerId: IDS.bravo,
          displayName: 'Dr Bravo',
          color: '#10b981',
          total: 0,
          completed: 0,
          noShow: 0,
          cancelled: 0,
          presenceRate: null,
          bookedMinutes: 0,
          openMinutes: 0,
          rate: null,
        },
      ],
      series: starts.map((start, i) => ({
        start,
        scheduled: 0,
        completed: i + 1,
        noShow: i === 1 ? 1 : 0,
        cancelled: 0,
      })),
      topTypes: [
        {
          appointmentTypeId: IDS.consult,
          name: 'Consultation',
          color: '#10b981',
          count: 6,
          share: 6 / 9,
        },
      ],
    },
    patients: { active: 5, new: 2, previousNew: 1 },
    receivables: { totalRemainingCents: 3000, patients: 1 },
    unbilled: {
      count: 1,
      exempt: 2,
      items: [
        {
          appointmentId: '01a0de00-0000-7000-8000-00000000f001',
          startAt: '2026-09-07T11:00:00.000Z',
          practitionerId: IDS.alpha,
          patient: { id: IDS.patient, lastName: 'Dupont', firstName: 'Léa' },
          appointmentTypeName: 'Consultation',
        },
      ],
    },
    ...(role === 'SECRETARY'
      ? {}
      : {
          revenue: {
            totalCents: 11000,
            count: 3,
            previousTotalCents: 10000,
            voided: { amountCents: 1000, count: 1 },
            series: starts.map((start, i) => ({
              start,
              amountCents: [2000, 0, 9000][i]!,
              count: i === 1 ? 0 : 1,
            })),
            byPractitioner: [
              { practitionerId: IDS.alpha, displayName: 'Dr Alpha', amountCents: 6000, count: 1 },
              { practitionerId: null, displayName: null, amountCents: 5000, count: 2 },
            ],
          },
        }),
  };
}
