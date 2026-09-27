import type { MeResponse, Practitioner, Role } from '@dental/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IDS,
  appointment,
  availability,
  clinic,
  consultation,
  patientDetail,
  practitioner,
} from '../../test/fixtures';
import { me, mockApi, renderApp, type MockCall } from '../../test/render';

// Lundi 28 septembre 2026, 10 h à Paris.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Handlers = Parameters<typeof mockApi>[0];
const alpha = practitioner(IDS.alpha, 'Dr Alpha', IDS.me);
const bravo = practitioner(IDS.bravo, 'Dr Bravo');
// 9 h chez Dr Alpha (commencé), 11 h chez Dr Alpha, 14 h chez Dr Bravo.
const nine = appointment();
const eleven = appointment({
  id: '01a0de00-0000-7000-8000-00000000f002',
  patient: { id: IDS.patient, lastName: 'Martin', firstName: 'Hugo', primaryPhone: null },
  startAt: '2026-09-28T09:00:00.000Z',
  endAt: '2026-09-28T09:30:00.000Z',
});
const two = appointment({
  id: '01a0de00-0000-7000-8000-00000000f003',
  practitionerId: IDS.bravo,
  patient: { id: IDS.patient, lastName: 'Petit', firstName: 'Chloé', primaryPhone: null },
  startAt: '2026-09-28T12:00:00.000Z',
  endAt: '2026-09-28T12:30:00.000Z',
});

function setup(
  session: MeResponse,
  practitioners: Practitioner[] = [alpha, bravo],
  extra: Handlers = {},
) {
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: session }),
    'GET /api/clinic': () => ({ status: 200, body: clinic() }),
    'GET /api/practitioners': () => ({ status: 200, body: { practitioners } }),
    'GET /api/appointment-types': () => ({
      status: 200,
      body: { appointmentTypes: [consultation] },
    }),
    'GET /api/availability': () => ({
      status: 200,
      body: availability(practitioners.map((p) => p.id)),
    }),
    'GET /api/appointments': (call) => ({
      status: 200,
      body: {
        appointments: [nine, eleven, two].filter(
          (a) => !call.url.includes('practitionerId=') || call.url.includes(a.practitionerId),
        ),
      },
    }),
    ...extra,
  });
}
const listUrl = (calls: MockCall[]) =>
  calls.filter((c) => c.url.startsWith('/api/appointments?')).map((c) => c.url);

describe('accueil « Aujourd’hui »', () => {
  it('dentiste lié à un praticien : « Ma journée » d’abord, puis tout le cabinet', async () => {
    const calls = setup(me('DENTIST'));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Ma journée' })).toBeInTheDocument();
    const mine = await screen.findByRole('list', { name: 'Rendez-vous du jour : Dr Alpha' });
    expect(within(mine).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 rendez-vous')).toBeInTheDocument();
    expect(listUrl(calls)).toEqual([
      `/api/appointments?from=2026-09-28&to=2026-09-28&practitionerId=${IDS.alpha}`,
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Tout le cabinet' }));
    expect(
      await screen.findByRole('heading', { name: "Aujourd'hui au cabinet" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('list', { name: 'Rendez-vous du jour : Dr Bravo' }),
    ).toBeInTheDocument();
    expect(listUrl(calls).at(-1)).toBe('/api/appointments?from=2026-09-28&to=2026-09-28');
  });

  it('secrétaire : tout le cabinet ; prochain rendez-vous signalé ; statuts rapides après l’heure seulement', async () => {
    // Aucun praticien lié au compte de la secrétaire.
    const calls = setup(me('SECRETARY'), [practitioner(IDS.alpha, 'Dr Alpha'), bravo], {
      [`POST /api/appointments/${nine.id}/status`]: () => ({
        status: 200,
        body: { ...nine, status: 'COMPLETED', version: 2 },
      }),
    });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: "Aujourd'hui au cabinet" }),
    ).toBeInTheDocument();
    const alphaList = await screen.findByRole('list', { name: 'Rendez-vous du jour : Dr Alpha' });
    const [first, second] = within(alphaList).getAllByRole('listitem');
    // 9 h : commencé ; 11 h : prochain rendez-vous.
    expect(within(second!).getByText('Prochain rendez-vous')).toBeInTheDocument();
    expect(within(second!).queryByRole('button', { name: /Marquer honoré/ })).toBeNull();
    fireEvent.click(
      within(first!).getByRole('button', { name: 'Marquer honoré : 09:00–09:30 DUPONT Léa' }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        version: 1,
        status: 'COMPLETED',
        reason: null,
      }),
    );
    expect(screen.getByRole('link', { name: 'Nouveau rendez-vous' })).toHaveAttribute(
      'href',
      '/agenda?nouveau=1',
    );
    expect(screen.queryByRole('heading', { name: 'Mise en route du cabinet' })).toBeNull();
  });

  it('administrateur : mise en route tant qu’il manque horaires, type ou coordonnées', async () => {
    setup(me('ADMIN'), [alpha, bravo], {
      'GET /api/clinic': () => ({ status: 200, body: clinic({ phone: null }) }),
      'GET /api/appointment-types': () => ({ status: 200, body: { appointmentTypes: [] } }),
      'GET /api/availability': () => ({ status: 200, body: availability([IDS.alpha]) }),
    });
    renderApp('/');
    const setupBox = await screen.findByRole('region', { name: 'Mise en route du cabinet' });
    const links = within(setupBox).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      `/disponibilites?praticien=${IDS.bravo}`,
      '/cabinet/types-de-rendez-vous',
      '/cabinet',
    ]);
    expect(links[0]).toHaveTextContent('Définir les horaires de Dr Bravo');
  });

  it('cabinet complet : pas de mise en route', async () => {
    setup(me('ADMIN'));
    renderApp('/');
    await screen.findByRole('list', { name: 'Rendez-vous du jour : Dr Alpha' });
    expect(screen.queryByRole('region', { name: 'Mise en route du cabinet' })).toBeNull();
  });
});

describe('navigation', () => {
  const navLinks = () =>
    within(screen.getByRole('navigation', { name: 'Navigation principale' }))
      .getAllByRole('link')
      .map((l) => l.textContent);

  it.each<[Role, string[]]>([
    ['SECRETARY', ["Aujourd'hui", 'Agenda', 'Patients', 'Disponibilités']],
    ['DENTIST', ["Aujourd'hui", 'Agenda', 'Patients', 'Disponibilités']],
    ['ADMIN', ["Aujourd'hui", 'Agenda', 'Patients', 'Disponibilités', 'Cabinet', 'Utilisateurs']],
  ])('%s : menu selon les permissions', async (role, expected) => {
    setup(me(role));
    renderApp('/');
    await screen.findByRole('heading', { name: /Bonjour/ });
    expect(navLinks()).toEqual(expected);
  });

  it('menu du téléphone : ouvert et refermé ; titre de l’onglet ; focus sur le contenu', async () => {
    setup(me('SECRETARY'), [alpha, bravo], {
      'GET /api/availability-blocks': () => ({ status: 200, body: { blocks: [] } }),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: /Bonjour/ });
    expect(document.title).toBe("Aujourd'hui · Cabinet du Parc");
    const toggle = screen.getByRole('button', { name: 'Menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Fermer le menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Disponibilités' }));
    await screen.findByRole('heading', { name: 'Disponibilités' });
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.title).toBe('Disponibilités · Cabinet du Parc');
    expect(document.activeElement).toBe(document.getElementById('contenu'));
  });

  it('recherche rapide : résultats du serveur, ouverture de la fiche', async () => {
    const calls = setup(me('SECRETARY'), [alpha, bravo], {
      'GET /api/patients': () => ({
        status: 200,
        body: {
          // Champs superflus de la fiche ignorés par le schéma de la liste.
          patients: [patientDetail()],
          total: 1,
        },
      }),
      [`GET /api/patients/${IDS.patient}`]: () => ({ status: 200, body: patientDetail() }),
      [`GET /api/patients/${IDS.patient}/appointments`]: () => ({
        status: 200,
        body: { appointments: [] },
      }),
    });
    renderApp('/');
    await screen.findByRole('heading', { name: /Bonjour/ });
    const search = screen.getByRole('searchbox', { name: 'Rechercher un patient' });
    fireEvent.change(search, { target: { value: '0612' } });
    const results = await screen.findByRole('list', { name: 'Patients trouvés' });
    expect(calls.find((c) => c.url.startsWith('/api/patients?'))?.url).toBe(
      '/api/patients?q=0612&status=ACTIVE&limit=6',
    );
    fireEvent.click(within(results).getByRole('link', { name: /DUPONT Léa/ }));
    expect(await screen.findByRole('heading', { name: 'DUPONT Léa' })).toBeInTheDocument();
    expect(search).toHaveValue('');
  });
});
