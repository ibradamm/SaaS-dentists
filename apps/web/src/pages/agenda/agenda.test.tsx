import type {
  Appointment,
  AppointmentType,
  AvailabilityResponse,
  PatientDetail,
  Permission,
  Practitioner,
  Role,
} from '@dental/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
// Aucun praticien lié au compte connecté (secrétaire) ; `linked` : le compte est Dr Bravo.
const practitioners = [
  practitioner(DR_ALPHA, 'Dr Alpha', null),
  practitioner(DR_BRAVO, 'Dr Bravo', null),
];
const linked = [
  practitioner(DR_ALPHA, 'Dr Alpha', null),
  practitioner(DR_BRAVO, 'Dr Bravo', ME_ID),
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
    billingExempt: false,
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
  options: { timezone?: string; without?: Permission[] } = {},
) {
  const session = me(role);
  session.permissions = session.permissions.filter((p) => !options.without?.includes(p));
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

  it('vue semaine : un praticien, sept jours, requête filtrée ; le sien présélectionné', async () => {
    const calls = setup('DENTIST', {
      'GET /api/practitioners': () => ({ status: 200, body: { practitioners: linked } }),
      'GET /api/appointments': () => ({
        status: 200,
        body: {
          appointments: [
            appointment({
              practitionerId: DR_BRAVO,
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
    // Le dentiste voit d'abord son propre agenda (Dr Bravo), pas le premier de la liste.
    expect(screen.getByLabelText('Agenda de')).toHaveValue(DR_BRAVO);
    expect(calls.find((c) => c.url.startsWith('/api/appointments?'))?.url).toBe(
      `/api/appointments?from=2026-09-28&to=2026-10-04&practitionerId=${DR_BRAVO}`,
    );
  });

  it('compte lié à un praticien : sa semaine par défaut ; « Jour » affiche tout le cabinet', async () => {
    const calls = setup('DENTIST', {
      'GET /api/practitioners': () => ({ status: 200, body: { practitioners: linked } }),
    });
    renderApp('/agenda');
    await screen.findByRole('heading', { name: 'Semaine du lundi 28 septembre 2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Jour' }));
    await screen.findByRole('heading', { name: 'lundi 28 septembre 2026' });
    expect(
      await screen.findByRole('button', { name: /^Dr Alpha, 09:00–09:30 DUPONT Léa/ }),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.url.startsWith('/api/appointments?')).map((c) => c.url)).toEqual([
      `/api/appointments?from=2026-09-28&to=2026-10-04&practitionerId=${DR_BRAVO}`,
      '/api/appointments?from=2026-09-28&to=2026-09-28',
    ]);
  });

  it('deux changements rapprochés (vue puis date) : aucun n’efface l’autre', async () => {
    setup('DENTIST', {
      'GET /api/practitioners': () => ({ status: 200, body: { practitioners: linked } }),
    });
    renderApp('/agenda');
    await screen.findByRole('heading', { name: 'Semaine du lundi 28 septembre 2026' });
    // Même lot de rendu : le second changement ne doit pas repartir de l'adresse d'avant.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Jour' }));
      fireEvent.change(screen.getByLabelText('Aller au'), { target: { value: '2026-09-29' } });
    });
    expect(
      await screen.findByRole('heading', { name: 'mardi 29 septembre 2026' }),
    ).toBeInTheDocument();
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
    const { idempotencyKey, ...firstBody } = posts(calls, '/api/appointments')[0]?.body as {
      idempotencyKey: string;
    };
    expect(firstBody).toEqual({
      practitionerId: DR_ALPHA,
      patientId: PATIENT,
      appointmentTypeId: TYPE_CONSULT,
      start: '2026-09-28T19:00',
      durationMinutes: 30,
      note: null,
      allowOutsideAvailability: false,
    });
    expect(idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

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
    // Un refus du serveur (4xx) n'a rien créé : chaque envoi suivant porte une nouvelle clé.
    const keys = posts(calls, '/api/appointments').map(
      (c) => (c.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(3);
  });

  it('réseau coupé puis nouvel essai : même clé d’idempotence ; saisie suivante : nouvelle clé', async () => {
    let attempts = 0;
    const calls = setup('SECRETARY', {
      'POST /api/appointments': () => {
        attempts += 1;
        // Issue inconnue : la requête a pu atteindre le serveur.
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return { status: 201, body: appointment() };
      },
    });
    renderApp('/agenda');
    let form = await openNewForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    expect(await within(form).findByText(/Vérifiez votre connexion/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    await screen.findByText('Rendez-vous enregistré.');
    form = await openNewForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    await waitFor(() => expect(posts(calls, '/api/appointments')).toHaveLength(3));
    const keys = posts(calls, '/api/appointments').map(
      (c) => (c.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('dans le passé : raison affichée clairement, confirmation seulement sur clic', async () => {
    const calls = setup('SECRETARY', {
      'POST /api/appointments': (call) =>
        (call.body as { allowOutsideAvailability: boolean }).allowOutsideAvailability
          ? { status: 201, body: appointment() }
          : {
              status: 409,
              body: {
                error: {
                  code: 'AVAILABILITY_CONFIRMATION_REQUIRED',
                  message:
                    "Ce rendez-vous est dans le passé. Confirmez pour l'enregistrer quand même.",
                  reasons: ['IN_PAST'],
                },
              },
            },
    });
    renderApp('/agenda');
    const form = await openNewForm();
    // 8 h, alors qu'il est 10 h au cabinet.
    fireEvent.change(within(form).getByLabelText('Heure'), { target: { value: '08:00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    const warning = await within(form).findByRole('alert');
    expect(within(warning).getByRole('listitem')).toHaveTextContent('Rendez-vous dans le passé');
    expect(posts(calls, '/api/appointments')).toHaveLength(1);
    fireEvent.click(within(form).getByRole('button', { name: 'Confirmer quand même' }));
    await screen.findByText('Rendez-vous enregistré.');
    expect(
      posts(calls, '/api/appointments').map(
        (c) => (c.body as { allowOutsideAvailability: boolean }).allowOutsideAvailability,
      ),
    ).toEqual([false, true]);
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

  it('panneau : focus sur son titre, Échap le ferme et rend le focus au rendez-vous', async () => {
    setup('SECRETARY');
    renderApp('/agenda');
    const opener = await screen.findByRole('button', { name: /^Dr Bravo, 14:00/ });
    opener.focus();
    fireEvent.click(opener);
    const details = await panel('Rendez-vous');
    await waitFor(() =>
      expect(document.activeElement).toBe(within(details).getByRole('heading', { level: 2 })),
    );
    fireEvent.keyDown(details, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(document.activeElement).toBe(opener);
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
    setup('SECRETARY', {}, { without: ['appointment.write'] });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: /Dr Alpha, 09:00/ }));
    const details = await panel('Rendez-vous');
    await within(details).findByText('Consultation');
    expect(screen.queryByRole('button', { name: 'Nouveau rendez-vous' })).toBeNull();
    expect(within(details).queryByRole('button', { name: 'Marquer honoré' })).toBeNull();
    expect(within(details).queryByRole('button', { name: 'Modifier ou déplacer' })).toBeNull();
  });

  it('« Encaisser » : lien vers le compte du patient, formulaire ouvert sur ce rendez-vous', async () => {
    setup('SECRETARY');
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: /Dr Alpha, 09:00/ }));
    const details = await panel('Rendez-vous');
    expect(await within(details).findByRole('link', { name: 'Encaisser' })).toHaveAttribute(
      'href',
      `/patients/${PATIENT}?encaisser=${RDV_PAST}#paiements`,
    );
  });

  it('« Sans facturation » : mention envoyée ; rendez-vous marqué : badge, rétablissement, pas d’encaissement', async () => {
    let exempt = false;
    const calls = setup('SECRETARY', {
      [`GET /api/appointments/${RDV_PAST}`]: () => ({
        status: 200,
        body: { ...past, billingExempt: exempt },
      }),
      [`POST /api/appointments/${RDV_PAST}/billing`]: (call) => {
        exempt = (call.body as { billingExempt: boolean }).billingExempt;
        return { status: 200, body: { appointmentId: RDV_PAST, billingExempt: exempt } };
      },
    });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: /Dr Alpha, 09:00/ }));
    const details = await panel('Rendez-vous');
    fireEvent.click(await within(details).findByRole('button', { name: 'Sans facturation' }));
    await waitFor(() =>
      expect(posts(calls, `/api/appointments/${RDV_PAST}/billing`)[0]?.body).toEqual({
        billingExempt: true,
      }),
    );
    expect(
      await within(details).findByText('Sans facturation', { selector: 'span' }),
    ).toBeVisible();
    expect(within(details).queryByRole('link', { name: 'Encaisser' })).toBeNull();
    fireEvent.click(within(details).getByRole('button', { name: 'Rétablir la facturation' }));
    await waitFor(() =>
      expect(posts(calls, `/api/appointments/${RDV_PAST}/billing`)[1]?.body).toEqual({
        billingExempt: false,
      }),
    );
    expect(await within(details).findByRole('link', { name: 'Encaisser' })).toBeVisible();
  });

  it('sans droit de saisie des paiements : pas de lien « Encaisser »', async () => {
    setup('SECRETARY', {}, { without: ['payment.write'] });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: /Dr Alpha, 09:00/ }));
    const details = await panel('Rendez-vous');
    await within(details).findByText('Consultation');
    expect(within(details).queryByRole('link', { name: 'Encaisser' })).toBeNull();
  });

  it('appel d’un nouveau patient : fiche créée dans le formulaire, doublon proposé d’abord', async () => {
    const NEW_ID = '01a0de00-0000-7000-8000-00000000a0ff';
    let duplicateChecks = 0;
    const calls = setup('SECRETARY', {
      'GET /api/patients': () => ({ status: 200, body: { patients: [], total: 0 } }),
      'GET /api/patients/duplicates': () => {
        duplicateChecks += 1;
        // Premier contrôle : un homonyme ; le second (après correction) : aucun.
        return duplicateChecks === 1
          ? {
              status: 200,
              body: {
                candidates: [{ ...patientDetail, lastName: 'Lefevre', firstName: 'Jules' }],
              },
            }
          : { status: 200, body: { candidates: [] } };
      },
      'POST /api/patients': (call) => ({
        status: 201,
        body: {
          ...patientDetail,
          id: NEW_ID,
          lastName: (call.body as { lastName: string }).lastName,
          firstName: (call.body as { firstName: string }).firstName,
          primaryPhone: '+33611223344',
        },
      }),
      'POST /api/appointments': () => ({ status: 201, body: appointment() }),
    });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: 'Nouveau rendez-vous' }));
    const form = await panel('Nouveau rendez-vous');
    fireEvent.change(within(form).getByLabelText('Patient'), { target: { value: 'Lefèvre' } });
    await within(form).findByText('Aucun patient trouvé.');
    fireEvent.click(within(form).getByRole('button', { name: 'Nouveau patient' }));
    const newPatient = within(form).getByRole('group', { name: 'Nouveau patient' });
    expect(within(newPatient).getByLabelText(/^Nom/)).toHaveValue('Lefèvre');
    fireEvent.change(within(newPatient).getByLabelText(/^Prénom/), { target: { value: 'Jules' } });
    fireEvent.change(within(newPatient).getByLabelText('Téléphone'), {
      target: { value: '06 11 22 33 44' },
    });
    fireEvent.click(within(newPatient).getByRole('button', { name: 'Créer le patient' }));
    // Homonyme : proposé avant toute création.
    expect(
      await within(newPatient).findByRole('button', { name: /Choisir LEFEVRE Jules/ }),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/patients')).toBe(false);
    fireEvent.click(within(newPatient).getByRole('button', { name: 'Créer quand même' }));
    expect(await within(form).findByText(/LEFÈVRE Jules/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/patients')?.body).toEqual({
      lastName: 'Lefèvre',
      firstName: 'Jules',
      birthDate: null,
      contacts: [{ phone: '06 11 22 33 44' }],
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Enregistrer le rendez-vous' }));
    await screen.findByText('Rendez-vous enregistré.');
    expect(posts(calls, '/api/appointments')[0]?.body).toMatchObject({ patientId: NEW_ID });
  });

  it('sans droit sur les patients : pas de création depuis le formulaire', async () => {
    const session = me('SECRETARY');
    session.permissions = session.permissions.filter((p) => p !== 'patient.write');
    setup('SECRETARY', { 'GET /api/auth/me': () => ({ status: 200, body: session }) });
    renderApp('/agenda');
    fireEvent.click(await screen.findByRole('button', { name: 'Nouveau rendez-vous' }));
    const form = await panel('Nouveau rendez-vous');
    expect(within(form).queryByRole('button', { name: 'Nouveau patient' })).toBeNull();
  });

  describe('téléphone', () => {
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(max-width: 639px)',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
    });

    it('vue jour : un praticien à la fois, au choix', async () => {
      setup('SECRETARY');
      renderApp('/agenda?vue=jour');
      expect(
        await screen.findByRole('button', { name: /^Dr Alpha, 09:00–09:30 DUPONT Léa/ }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Dr Bravo, / })).toBeNull();
      fireEvent.change(screen.getByLabelText('Agenda de'), { target: { value: DR_BRAVO } });
      expect(await screen.findByRole('button', { name: /^Dr Bravo, 14:00/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Dr Alpha, / })).toBeNull();
    });

    it('vue semaine : une liste par jour au lieu de la grille', async () => {
      setup('SECRETARY');
      renderApp('/agenda?vue=semaine');
      const monday = await screen.findByRole('region', { name: 'lundi 28 septembre' });
      expect(
        within(monday).getByRole('link', {
          name: 'Ouvrir le rendez-vous : 09:00–09:30 DUPONT Léa',
        }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole('region', { name: 'mardi 29 septembre' })).getByText(
          'Aucun rendez-vous.',
        ),
      ).toBeInTheDocument();
    });
  });
});
