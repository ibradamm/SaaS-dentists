import type {
  Appointment,
  AvailabilityBlock,
  AvailabilityResponse,
  Practitioner,
  Role,
  SchedulePeriod,
} from '@dental/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { me, mockApi, renderApp } from '../../test/render';

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

const practitioner = (id: string, displayName: string, userId: string | null): Practitioner => ({
  id,
  displayName,
  color: '#0ea5e9',
  userId,
  userFullName: userId ? 'Camille Martin' : null,
  status: 'ACTIVE',
  version: 1,
});

const clinic = {
  id: '01a0de00-0000-7000-8000-0000000000c1',
  name: 'Cabinet du Parc',
  timezone: 'Europe/Paris',
  locale: 'fr-FR',
  currency: 'EUR',
  countryCode: 'FR',
  addressLine1: null,
  addressLine2: null,
  postalCode: null,
  city: null,
  phone: null,
  email: null,
};

const period: SchedulePeriod = {
  id: '01a0de00-0000-7000-8000-0000000000e1',
  validFrom: '2026-09-01',
  validTo: null,
  version: 3,
  intervals: [
    { weekday: 1, start: '09:00', end: '12:00' },
    { weekday: 1, start: '14:00', end: '18:00' },
  ],
};

const block: AvailabilityBlock = {
  id: '01a0de00-0000-7000-8000-0000000000f1',
  practitionerId: DR_ALPHA,
  kind: 'BLOCK',
  startAt: '2026-09-28T08:00:00.000Z',
  endAt: '2026-09-28T09:00:00.000Z',
  allDay: false,
  label: 'Réunion',
  version: 1,
};
const closure: AvailabilityBlock = {
  ...block,
  id: '01a0de00-0000-7000-8000-0000000000f2',
  practitionerId: null,
  kind: 'ABSENCE',
  startAt: '2026-12-24T23:00:00.000Z',
  endAt: '2026-12-25T23:00:00.000Z',
  allDay: true,
  label: 'Noël',
};

// Rendez-vous du lundi 26 octobre à 9 h (heure d'hiver : 8 h UTC).
const conflict: Appointment = {
  id: '01a0de00-0000-7000-8000-00000000f0f0',
  practitionerId: DR_ALPHA,
  patient: {
    id: '01a0de00-0000-7000-8000-00000000a001',
    lastName: 'Dupont',
    firstName: 'Léa',
    primaryPhone: null,
  },
  appointmentType: {
    id: '01a0de00-0000-7000-8000-0000000000d1',
    name: 'Consultation',
    color: '#10b981',
  },
  startAt: '2026-10-26T08:00:00.000Z',
  endAt: '2026-10-26T08:30:00.000Z',
  durationMinutes: 30,
  status: 'SCHEDULED',
  note: null,
  cancellationReason: null,
  billingExempt: false,
  version: 1,
};

const availability: AvailabilityResponse = {
  timezone: 'Europe/Paris',
  from: '2026-09-28',
  to: '2026-10-04',
  practitioners: [
    {
      practitionerId: DR_ALPHA,
      working: [
        { start: '2026-09-28T07:00:00.000Z', end: '2026-09-28T10:00:00.000Z' },
        { start: '2026-09-28T12:00:00.000Z', end: '2026-09-28T16:00:00.000Z' },
      ],
      available: [
        { start: '2026-09-28T07:00:00.000Z', end: '2026-09-28T08:00:00.000Z' },
        { start: '2026-09-28T09:00:00.000Z', end: '2026-09-28T10:00:00.000Z' },
        { start: '2026-09-28T12:00:00.000Z', end: '2026-09-28T16:00:00.000Z' },
      ],
    },
  ],
  blocks: [block],
};

function setup(role: Role, practitioners: Practitioner[], extra = {}) {
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: me(role) }),
    'GET /api/clinic': () => ({ status: 200, body: clinic }),
    'GET /api/practitioners': () => ({ status: 200, body: { practitioners } }),
    'GET /api/availability': () => ({ status: 200, body: availability }),
    [`GET /api/practitioners/${DR_ALPHA}/schedules`]: () => ({
      status: 200,
      body: { periods: [period] },
    }),
    [`GET /api/practitioners/${DR_BRAVO}/schedules`]: () => ({
      status: 200,
      body: { periods: [] },
    }),
    'GET /api/availability-blocks': () => ({ status: 200, body: { blocks: [block, closure] } }),
    ...extra,
  });
}

describe('disponibilités', () => {
  it('cabinet à un seul praticien : pas de choix, semaine en heure du cabinet', async () => {
    const calls = setup('SECRETARY', [practitioner(DR_ALPHA, 'Dr Alpha', null)]);
    renderApp('/disponibilites');
    await screen.findByRole('heading', { name: 'Semaine du lundi 28 septembre' });
    expect(screen.queryByLabelText('Praticien')).not.toBeInTheDocument();
    expect(screen.getByText('Dr Alpha')).toBeInTheDocument();
    const monday = await screen.findByRole('row', { name: /lundi 28 septembre/ });
    expect(within(monday).getByText('09:00–12:00, 14:00–18:00')).toBeInTheDocument();
    expect(within(monday).getByText('09:00–10:00, 11:00–12:00, 14:00–18:00')).toBeInTheDocument();
    expect(within(monday).getByText(/Créneau bloqué : Réunion/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.startsWith('/api/availability?'))?.url).toBe(
      `/api/availability?from=2026-09-28&to=2026-10-04&practitionerId=${DR_ALPHA}`,
    );
  });

  it('plusieurs praticiens : le dentiste voit le sien d’abord, l’agenda d’un confrère en lecture seule', async () => {
    setup('DENTIST', [
      practitioner(DR_BRAVO, 'Dr Bravo', '01a0de00-0000-7000-8000-00000000dddd'),
      practitioner(DR_ALPHA, 'Dr Alpha', ME_ID),
    ]);
    renderApp('/disponibilites');
    const select = await screen.findByLabelText('Praticien');
    expect(select).toHaveValue(DR_ALPHA);
    expect(screen.queryByText(/Consultation seule/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Horaires' }));
    expect(
      await screen.findByRole('heading', { name: 'Modifier les horaires' }),
    ).toBeInTheDocument();

    fireEvent.change(select, { target: { value: DR_BRAVO } });
    expect(await screen.findByText(/Consultation seule/)).toBeInTheDocument();
    expect(await screen.findByText(/Aucun horaire/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Modifier les horaires' }),
    ).not.toBeInTheDocument();
  });

  it('modification des horaires à partir d’une date : période de référence envoyée, chevauchement bloqué', async () => {
    let body: unknown;
    setup('SECRETARY', [practitioner(DR_ALPHA, 'Dr Alpha', null)], {
      [`PUT /api/practitioners/${DR_ALPHA}/schedules`]: (call: { body: unknown }) => {
        body = call.body;
        return {
          status: 200,
          body: {
            periods: [
              { ...period, validTo: '2026-10-05' },
              {
                ...period,
                id: '01a0de00-0000-7000-8000-0000000000e2',
                validFrom: '2026-10-05',
                version: 1,
              },
            ],
            conflicts: [],
          },
        };
      },
    });
    renderApp('/disponibilites');
    fireEvent.click(await screen.findByRole('tab', { name: 'Horaires' }));
    await screen.findByText('Depuis le 01/09/2026');
    // Plages numérotées dans leur journée (« mardi, plage 1 »), pas sur toute la semaine.
    const tuesday = screen.getByRole('group', { name: 'Mardi' });
    fireEvent.click(within(tuesday).getByRole('button', { name: 'Ajouter une plage' }));
    expect(screen.getByLabelText('Mardi, début de la plage 1')).toBeInTheDocument();
    fireEvent.click(within(tuesday).getByRole('button', { name: /^Retirer la plage/ }));
    fireEvent.change(screen.getByLabelText('Applicables à partir du'), {
      target: { value: '2026-10-05' },
    });
    // Le lundi après-midi finit à 17 h au lieu de 18 h.
    fireEvent.change(screen.getByLabelText('Lundi, fin de la plage 2'), {
      target: { value: '17:00' },
    });
    // Une plage qui chevauche la matinée bloque l'enregistrement.
    fireEvent.change(screen.getByLabelText('Lundi, début de la plage 2'), {
      target: { value: '11:00' },
    });
    expect(await screen.findByText('Deux plages du même jour se chevauchent')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Enregistrer à partir du 05/10/2026' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Lundi, début de la plage 2'), {
      target: { value: '14:00' },
    });
    fireEvent.click(save);
    await screen.findByText('Horaires enregistrés.');
    expect(body).toEqual({
      validFrom: '2026-10-05',
      basePeriod: { id: period.id, version: 3 },
      intervals: [
        { weekday: 1, start: '09:00', end: '12:00' },
        { weekday: 1, start: '14:00', end: '17:00' },
      ],
    });
    expect(screen.getByText('Du 01/09/2026 au 04/10/2026')).toBeInTheDocument();
  });

  it('absences : fermeture du cabinet réservée au secrétariat, saisie en journées entières', async () => {
    const calls = setup('DENTIST', [practitioner(DR_ALPHA, 'Dr Alpha', ME_ID)], {
      'POST /api/availability-blocks': () => ({
        status: 201,
        body: { block: { ...block, kind: 'ABSENCE' }, conflicts: [conflict] },
      }),
    });
    renderApp('/disponibilites');
    fireEvent.click(await screen.findByRole('tab', { name: 'Absences et blocages' }));
    const list = await screen.findByRole('list', { name: 'Absences et blocages' });
    expect(await within(list).findByText('Le 28/09/2026 de 10:00 à 11:00')).toBeInTheDocument();
    expect(within(list).getByText('Le 25/12/2026')).toBeInTheDocument();
    // Le dentiste supprime son blocage, pas la fermeture du cabinet.
    expect(within(list).getAllByRole('button', { name: 'Supprimer' })).toHaveLength(1);
    const scope = screen.getByLabelText('Concerne');
    expect(within(scope).queryByText(/Tout le cabinet/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-10-24' } });
    fireEvent.change(screen.getByLabelText('Au (inclus)'), { target: { value: '2026-10-31' } });
    fireEvent.change(screen.getByLabelText('Libellé (facultatif)'), {
      target: { value: 'Congés' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      practitionerId: DR_ALPHA,
      kind: 'ABSENCE',
      label: 'Congés',
      allDay: true,
      startDate: '2026-10-24',
      endDate: '2026-10-31',
    });
    // Rendez-vous déjà prévus pendant l'absence : listés, jamais modifiés d'office.
    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('1 rendez-vous prévu est pendant cette absence');
    expect(within(warning).getByRole('link')).toHaveAttribute(
      'href',
      `/agenda?date=2026-10-26&rdv=${conflict.id}`,
    );
    expect(within(warning).getByRole('link')).toHaveTextContent(
      '26/10/2026 09:00 · DUPONT Léa · Consultation',
    );
  });

  it('après un nouveau blocage, la semaine n’affiche jamais l’ancienne disponibilité', async () => {
    let created = false;
    const before = {
      ...availability,
      blocks: [],
      practitioners: [
        { ...availability.practitioners[0]!, available: availability.practitioners[0]!.working },
      ],
    };
    setup('SECRETARY', [practitioner(DR_ALPHA, 'Dr Alpha', null)], {
      'GET /api/availability': () => ({ status: 200, body: created ? availability : before }),
      'POST /api/availability-blocks': () => {
        created = true;
        return { status: 201, body: { block, conflicts: [] } };
      },
    });
    renderApp('/disponibilites');
    const monday = await screen.findByRole('row', { name: /lundi 28 septembre/ });
    expect(within(monday).getAllByText('09:00–12:00, 14:00–18:00')).toHaveLength(2);

    fireEvent.click(screen.getByRole('tab', { name: 'Absences et blocages' }));
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'BLOCK' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(created).toBe(true));
    await screen.findByRole('button', { name: 'Ajouter' });

    fireEvent.click(screen.getByRole('tab', { name: 'Semaine' }));
    // Dès le retour sur la semaine, pas de disponibilité périmée affichée.
    expect(screen.queryAllByText('09:00–12:00, 14:00–18:00')).toHaveLength(0);
    const updated = await screen.findByRole('row', { name: /lundi 28 septembre/ });
    expect(within(updated).getByText('09:00–10:00, 11:00–12:00, 14:00–18:00')).toBeInTheDocument();
  });

  it('aucun praticien : l’administrateur est invité à en ajouter un', async () => {
    setup('ADMIN', []);
    renderApp('/disponibilites');
    expect(await screen.findByRole('link', { name: 'Ajouter un praticien' })).toHaveAttribute(
      'href',
      '/cabinet/praticiens',
    );
    cleanup();
    vi.unstubAllGlobals();
    setup('SECRETARY', []);
    renderApp('/disponibilites');
    expect(await screen.findByText(/Demandez à l'administrateur/)).toBeInTheDocument();
  });
});
