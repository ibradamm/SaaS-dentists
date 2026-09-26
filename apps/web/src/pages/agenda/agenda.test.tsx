import type {
  Appointment,
  AppointmentType,
  AvailabilityResponse,
  PatientDetail,
  Practitioner,
  Role,
} from '@dental/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { me, mockApi, renderApp, type MockCall } from '../../test/render';

// Lundi 28 septembre 2026, 10 h à Paris : seule l'horloge est simulée (pas les minuteries).
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ME_ID = '01a0de00-0000-7000-8000-000000000001';
const DR_ALPHA = '01a0de00-0000-7000-8000-0000000000a1';
const DR_BRAVO = '01a0de00-0000-7000-8000-0000000000b2';
const TYPE_CONSULT = '01a0de00-0000-7000-8000-0000000000d1';
const TYPE_DETARTRAGE = '01a0de00-0000-7000-8000-0000000000d2';
const PATIENT = '01a0de00-0000-7000-8000-00000000a001';
const RDV_PAST = '01a0de00-0000-7000-8000-00000000f001';
const RDV_LATER = '01a0de00-0000-7000-8000-00000000f002';

const practitioner = (id: string, displayName: string, userId: string | null): Practitioner => ({
  id,
  displayName,
  color: '#0ea5e9',
  userId,
  userFullName: userId ? 'Camille Martin' : null,
  status: 'ACTIVE',
  version: 1,
});
const practitioners = [
  practitioner(DR_ALPHA, 'Dr Alpha', ME_ID),
  practitioner(DR_BRAVO, 'Dr Bravo', null),
];

const types: AppointmentType[] = [
  {
    id: TYPE_CONSULT,
    name: 'Consultation',
    durationMinutes: 30,
    color: '#10b981',
    status: 'ACTIVE',
    version: 1,
  },
  {
    id: TYPE_DETARTRAGE,
    name: 'Détartrage',
    durationMinutes: 45,
    color: '#f59e0b',
    status: 'ACTIVE',
    version: 1,
  },
];

const clinic = (timezone = 'Europe/Paris') => ({
  id: '01a0de00-0000-7000-8000-0000000000c1',
  name: 'Cabinet du Parc',
  timezone,
  locale: 'fr-FR',
  currency: 'EUR',
  countryCode: 'FR',
  addressLine1: null,
  addressLine2: null,
  postalCode: null,
  city: null,
  phone: null,
  email: null,
});

const patient = {
  id: PATIENT,
  lastName: 'Dupont',
  firstName: 'Léa',
  primaryPhone: '+33612345678',
};

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: RDV_PAST,
    practitionerId: DR_ALPHA,
    patient,
    appointmentType: { id: TYPE_CONSULT, name: 'Consultation', color: '#10b981' },
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
// 9 h (commencé à 10 h) chez Dr Alpha ; 14 h (à venir) chez Dr Bravo.
const past = appointment();
const later = appointment({
  id: RDV_LATER,
  practitionerId: DR_BRAVO,
  patient: { ...patient, id: '01a0de00-0000-7000-8000-00000000a002', lastName: 'Martin' },
  startAt: '2026-09-28T12:00:00.000Z',
  endAt: '2026-09-28T12:45:00.000Z',
  durationMinutes: 45,
});

const working = [{ start: '2026-09-28T07:00:00.000Z', end: '2026-09-28T16:00:00.000Z' }];
const availability: AvailabilityResponse = {
  timezone: 'Europe/Paris',
  from: '2026-09-28',
  to: '2026-09-28',
  practitioners: [
    { practitionerId: DR_ALPHA, working, available: working },
    { practitionerId: DR_BRAVO, working, available: working },
  ],
  blocks: [
    {
      id: '01a0de00-0000-7000-8000-0000000000e1',
      practitionerId: DR_ALPHA,
      kind: 'BLOCK',
      startAt: '2026-09-28T10:00:00.000Z',
      endAt: '2026-09-28T11:00:00.000Z',
      allDay: false,
      label: 'Réunion',
      version: 1,
    },
  ],
};

const patientDetail: PatientDetail = {
  ...patient,
  birthDate: '1985-03-12',
  status: 'ACTIVE',
  email: null,
  administrativeNote: null,
  createdSource: 'STAFF',
  externalRef: null,
  version: 1,
  contacts: [],
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

type Handlers = Parameters<typeof mockApi>[0];

function setup(
  role: Role,
  extra: Handlers = {},
  options: { timezone?: string; withoutWrite?: boolean } = {},
) {
  const session = me(role);
  if (options.withoutWrite) {
    session.permissions = session.permissions.filter((p) => p !== 'appointment.write');
  }
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: session }),
    'GET /api/clinic': () => ({ status: 200, body: clinic(options.timezone) }),
    'GET /api/practitioners': () => ({ status: 200, body: { practitioners } }),
    'GET /api/appointment-types': () => ({ status: 200, body: { appointmentTypes: types } }),
    'GET /api/appointments': () => ({ status: 200, body: { appointments: [past, later] } }),
    'GET /api/availability': () => ({ status: 200, body: availability }),
    'GET /api/availability/slots': () => ({
      status: 200,
      body: {
        timezone: 'Europe/Paris',
        slots: ['2026-09-28T13:00:00.000Z', '2026-09-28T13:15:00.000Z'],
      },
    }),
    [`GET /api/appointments/${RDV_PAST}`]: () => ({ status: 200, body: past }),
    [`GET /api/appointments/${RDV_LATER}`]: () => ({ status: 200, body: later }),
    'GET /api/patients': () => ({
      status: 200,
      body: {
        patients: [{ ...patient, birthDate: '1985-03-12', status: 'ACTIVE' }],
        total: 1,
      },
    }),
    [`GET /api/patients/${PATIENT}`]: () => ({ status: 200, body: patientDetail }),
    ...extra,
  });
}

const panel = (name: string) => screen.findByRole('complementary', { name });
const posts = (calls: MockCall[], url: string) =>
  calls.filter((c) => c.method === 'POST' && c.url === url);

async function openNewForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Nouveau rendez-vous' }));
  const form = await panel('Nouveau rendez-vous');
  fireEvent.change(within(form).getByLabelText('Patient'), { target: { value: 'Dup' } });
  fireEvent.click(await within(form).findByRole('button', { name: /DUPONT Léa/ }));
  return form;
}

describe('agenda', () => {
  it('vue jour : une colonne par praticien, rendez-vous et blocages en heure du cabinet', async () => {
    const calls = setup('SECRETARY');
    renderApp('/agenda');
    await screen.findByRole('heading', { name: 'lundi 28 septembre 2026' });
    const first = await screen.findByRole('button', {
      name: 'Dr Alpha, 09:00–09:30 DUPONT Léa, Consultation, Prévu',
    });
    expect(first).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dr Bravo, 14:00–14:45 MARTIN Léa, Consultation, Prévu' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Créneau bloqué : Réunion')).toBeInTheDocument();
    expect(calls.find((c) => c.url.startsWith('/api/appointments?'))?.url).toBe(
      '/api/appointments?from=2026-09-28&to=2026-09-28',
    );
    expect(calls.find((c) => c.url.startsWith('/api/availability?'))?.url).toBe(
      '/api/availability?from=2026-09-28&to=2026-09-28',
    );
  });

  it('cabinet à New York : mêmes instants affichés à l’heure de New York, date du jour locale', async () => {
    setup('SECRETARY', {}, { timezone: 'America/New_York' });
    renderApp('/agenda');
    // 8 h UTC = 4 h à New York, toujours le lundi 28.
    await screen.findByRole('heading', { name: 'lundi 28 septembre 2026' });
    expect(
      await screen.findByRole('button', {
        name: 'Dr Alpha, 03:00–03:30 DUPONT Léa, Consultation, Prévu',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dr Bravo, 08:00–08:45 MARTIN Léa, Consultation, Prévu' }),
    ).toBeInTheDocument();
  });

  it('vue semaine : un praticien, sept jours, requête filtrée', async () => {
    const calls = setup('DENTIST', {
      'GET /api/appointments': () => ({
        status: 200,
        body: {
          appointments: [
            appointment({
              startAt: '2026-10-01T07:00:00.000Z',
              endAt: '2026-10-01T07:30:00.000Z',
            }),
          ],
        },
      }),
    });
    renderApp('/agenda?vue=semaine&date=2026-10-01');
    await screen.findByRole('heading', { name: 'Semaine du lundi 28 septembre 2026' });
    expect(
      await screen.findByRole('button', {
        name: 'jeudi 1 octobre, 09:00–09:30 DUPONT Léa, Consultation, Prévu',
      }),
    ).toBeInTheDocument();
    // Le dentiste voit d'abord son propre agenda.
    expect(screen.getByLabelText('Agenda de')).toHaveValue(DR_ALPHA);
    expect(calls.find((c) => c.url.startsWith('/api/appointments?'))?.url).toBe(
      `/api/appointments?from=2026-09-28&to=2026-10-04&practitionerId=${DR_ALPHA}`,
    );
  });

  it('hors horaires : aucune confirmation envoyée d’office ; « Confirmer quand même » renvoie la demande', async () => {
    const calls = setup('SECRETARY', {
      'POST /api/appointments': (call) =>
        (call.body as { allowOutsideAvailability: boolean }).allowOutsideAvailability
          ? { status: 201, body: appointment({ id: RDV_PAST }) }
          : {
              status: 409,
              body: {
                error: {
                  code: 'AVAILABILITY_CONFIRMATION_REQUIRED',
                  message: 'Rendez-vous en dehors des horaires de travail. Confirmation requise.',
                },
              },
            },
    });
    renderApp('/agenda');
    const form = await openNewForm();
    fireEvent.change(within(form).getByLabelText('Heure'), { target: { value: '19:00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    expect(await within(form).findByText(/en dehors des horaires/)).toBeInTheDocument();
    expect(posts(calls, '/api/appointments')).toHaveLength(1);
    expect(posts(calls, '/api/appointments')[0]?.body).toEqual({
      practitionerId: DR_ALPHA,
      patientId: PATIENT,
      appointmentTypeId: TYPE_CONSULT,
      start: '2026-09-28T19:00',
      durationMinutes: 30,
      note: null,
      allowOutsideAvailability: false,
    });

    // Modifier la saisie annule la demande de confirmation.
    fireEvent.change(within(form).getByLabelText('Heure'), { target: { value: '19:30' } });
    expect(within(form).queryByRole('button', { name: 'Confirmer quand même' })).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    fireEvent.click(await within(form).findByRole('button', { name: 'Confirmer quand même' }));
    await screen.findByText('Rendez-vous enregistré.');
    const sent = posts(calls, '/api/appointments').map(
      (c) => c.body as { start: string; allowOutsideAvailability: boolean },
    );
    expect(sent.map((b) => [b.start, b.allowOutsideAvailability])).toEqual([
      ['2026-09-28T19:00', false],
      ['2026-09-28T19:30', false],
      ['2026-09-28T19:30', true],
    ]);
  });

  it('absence du praticien : refus sans dérogation possible', async () => {
    setup('SECRETARY', {
      'POST /api/appointments': () => ({
        status: 409,
        body: {
          error: { code: 'PRACTITIONER_ABSENT', message: 'Le praticien est absent à cette date.' },
        },
      }),
    });
    renderApp('/agenda');
    const form = await openNewForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    expect(
      await within(form).findByText('Le praticien est absent à cette date.'),
    ).toBeInTheDocument();
    expect(within(form).queryByRole('button', { name: 'Confirmer quand même' })).toBeNull();
  });

  it('type : durée par défaut, modifiable ; créneau libre proposé ; clic sur la grille', async () => {
    const calls = setup('SECRETARY', {
      'POST /api/appointments': () => ({ status: 201, body: past }),
    });
    renderApp('/agenda');
    await screen.findByRole('button', { name: /Dr Alpha, 09:00/ });
    // Clic dans la colonne de Dr Bravo à 10 h (2 h sous le haut de la grille, qui commence à 8 h).
    fireEvent.click(screen.getByTestId(`grille-${DR_BRAVO}`), { clientY: 2 * 60 * 1.6 });
    const form = await panel('Nouveau rendez-vous');
    expect(within(form).getByLabelText('Praticien')).toHaveValue(DR_BRAVO);
    expect(within(form).getByLabelText('Heure')).toHaveValue('10:00');
    fireEvent.change(within(form).getByLabelText('Patient'), { target: { value: 'Dup' } });
    fireEvent.click(await within(form).findByRole('button', { name: /DUPONT Léa/ }));

    fireEvent.change(within(form).getByLabelText('Type de rendez-vous'), {
      target: { value: TYPE_DETARTRAGE },
    });
    expect(within(form).getByLabelText('Durée (minutes)')).toHaveValue(45);
    fireEvent.change(within(form).getByLabelText('Durée (minutes)'), { target: { value: '60' } });
    const slots = await within(form).findByRole('list', { name: 'Créneaux libres ce jour' });
    fireEvent.click(within(slots).getByRole('button', { name: '15:15' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    await screen.findByText('Rendez-vous enregistré.');
    expect(posts(calls, '/api/appointments')[0]?.body).toMatchObject({
      practitionerId: DR_BRAVO,
      appointmentTypeId: TYPE_DETARTRAGE,
      start: '2026-09-28T15:15',
      durationMinutes: 60,
    });
    expect(calls.some((c) => c.url.includes('/api/availability/slots?'))).toBe(true);
    expect(calls.find((c) => c.url.includes('durationMinutes=60'))?.url).toBe(
      `/api/availability/slots?practitionerId=${DR_BRAVO}&from=2026-09-28&to=2026-09-28&durationMinutes=60`,
    );
  });

  it('statuts : « honoré » seulement après l’heure de début ; annulation avec motif', async () => {
    const calls = setup('SECRETARY', {
      [`POST /api/appointments/${RDV_PAST}/status`]: () => ({
        status: 200,
        body: { ...past, status: 'COMPLETED', version: 2 },
      }),
      [`POST /api/appointments/${RDV_LATER}/status`]: () => ({
        status: 200,
        body: { ...later, status: 'CANCELLED', version: 2 },
      }),
    });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: /Dr Bravo, 14:00/ }));
    let details = await panel('Rendez-vous');
    expect(await within(details).findByRole('button', { name: 'Marquer honoré' })).toBeDisabled();
    expect(within(details).getByRole('button', { name: 'Marquer patient absent' })).toBeDisabled();
    fireEvent.click(within(details).getByRole('button', { name: 'Annuler le rendez-vous' }));
    fireEvent.change(within(details).getByLabelText("Motif d'annulation (facultatif)"), {
      target: { value: 'À la demande du patient' },
    });
    fireEvent.click(within(details).getByRole('button', { name: "Confirmer l'annulation" }));
    await waitFor(() =>
      expect(posts(calls, `/api/appointments/${RDV_LATER}/status`)[0]?.body).toEqual({
        version: 1,
        status: 'CANCELLED',
        reason: 'À la demande du patient',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /Dr Alpha, 09:00/ }));
    details = await panel('Rendez-vous');
    fireEvent.click(await within(details).findByRole('button', { name: 'Marquer honoré' }));
    await waitFor(() =>
      expect(posts(calls, `/api/appointments/${RDV_PAST}/status`)[0]?.body).toEqual({
        version: 1,
        status: 'COMPLETED',
        reason: null,
      }),
    );
    // Correction possible : retour à « Prévu ».
    expect(
      await within(details).findByRole('button', { name: 'Remettre à « Prévu »' }),
    ).toBeInTheDocument();
  });

  it('modification concurrente : message et rechargement, jamais d’écrasement', async () => {
    setup('SECRETARY', {
      [`POST /api/appointments/${RDV_PAST}/status`]: () => ({
        status: 409,
        body: {
          error: { code: 'CONFLICT', message: 'Le rendez-vous a été modifié entre-temps.' },
        },
      }),
    });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: /Dr Alpha, 09:00/ }));
    const details = await panel('Rendez-vous');
    fireEvent.click(await within(details).findByRole('button', { name: 'Marquer honoré' }));
    expect(
      await within(details).findByText(/vient d.être modifié par quelqu.un d.autre/),
    ).toBeInTheDocument();
    expect(within(details).getByRole('button', { name: 'Recharger' })).toBeInTheDocument();
  });

  it('déplacement : seuls les champs modifiés sont envoyés', async () => {
    const calls = setup('SECRETARY', {
      [`PATCH /api/appointments/${RDV_LATER}`]: () => ({
        status: 200,
        body: { ...later, startAt: '2026-09-28T13:00:00.000Z', version: 2 },
      }),
    });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: /Dr Bravo, 14:00/ }));
    const details = await panel('Rendez-vous');
    fireEvent.click(await within(details).findByRole('button', { name: 'Modifier ou déplacer' }));
    const save = within(details).getByRole('button', { name: 'Enregistrer les modifications' });
    expect(save).toBeDisabled();
    fireEvent.change(within(details).getByLabelText('Heure'), { target: { value: '15:00' } });
    fireEvent.click(save);
    await screen.findByText('Rendez-vous modifié.');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      version: 1,
      start: '2026-09-28T15:00',
      allowOutsideAvailability: false,
    });
  });

  it('lien depuis la fiche patient : formulaire prérempli avec le patient', async () => {
    setup('SECRETARY');
    renderApp(`/agenda?nouveau=1&patient=${PATIENT}`);
    const form = await panel('Nouveau rendez-vous');
    expect(await within(form).findByText(/DUPONT Léa/)).toBeInTheDocument();
    expect(within(form).getByLabelText('Praticien')).toHaveValue(DR_ALPHA);
  });

  it('sans droit d’écriture : consultation seule (le serveur refuse de toute façon)', async () => {
    setup('SECRETARY', {}, { withoutWrite: true });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: /Dr Alpha, 09:00/ }));
    const details = await panel('Rendez-vous');
    await within(details).findByText('Consultation');
    expect(screen.queryByRole('button', { name: 'Nouveau rendez-vous' })).toBeNull();
    expect(within(details).queryByRole('button', { name: 'Marquer honoré' })).toBeNull();
    expect(within(details).queryByRole('button', { name: 'Modifier ou déplacer' })).toBeNull();
  });
});
