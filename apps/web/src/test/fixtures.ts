import type {
  Appointment,
  AppointmentType,
  AvailabilityResponse,
  ClinicResponse,
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
