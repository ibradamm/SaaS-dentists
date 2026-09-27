import { formatCents, type DashboardResponse, type Role } from '@dental/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS, appointment, clinic, dashboard, practitioner } from '../../test/fixtures';
import { me, mockApi, renderApp, type MockCall } from '../../test/render';
import { niceMax } from './charts';
import {
  bucketLabel,
  formatChange,
  formatDuration,
  formatPeriod,
  formatRate,
  tickLabel,
} from './format';

// Lundi 28 septembre 2026, 10 h à Paris.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Texte tel que Testing Library le compare : espaces insécables ramenés à des espaces simples.
const eur = (cents: number) => formatCents(cents, 'EUR').replace(/\s/g, ' ');
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s/g, ' ');
const alpha = practitioner(IDS.alpha, 'Dr Alpha', IDS.me);
const bravo = practitioner(IDS.bravo, 'Dr Bravo');

function setup(
  role: Role,
  response?: (call: MockCall) => DashboardResponse,
  extra: Parameters<typeof mockApi>[0] = {},
) {
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: me(role) }),
    'GET /api/clinic': () => ({ status: 200, body: clinic() }),
    'GET /api/practitioners': () => ({ status: 200, body: { practitioners: [alpha, bravo] } }),
    'GET /api/appointments': () => ({ status: 200, body: { appointments: [appointment()] } }),
    'GET /api/dashboard': (call) => {
      const q = new URL(call.url, 'http://x').searchParams;
      const period = { from: q.get('from')!, to: q.get('to')! };
      return { status: 200, body: response ? response(call) : dashboard(role, period) };
    },
    ...extra,
  });
}
const dashboardCalls = (calls: MockCall[]) =>
  calls.filter((c) => c.url.startsWith('/api/dashboard?')).map((c) => c.url);
const tile = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).parentElement as HTMLElement;

describe('page « Statistiques »', () => {
  it('dentiste : mois en cours par défaut ; indicateurs calculés par le serveur', async () => {
    const calls = setup('DENTIST');
    renderApp('/statistiques');
    expect(await screen.findByText('septembre 2026', { exact: false })).toBeInTheDocument();
    expect(dashboardCalls(calls)).toContain('/api/dashboard?from=2026-09-01&to=2026-09-30');
    await screen.findByText('Revenus encaissés', { selector: 'dt' });
    expect(flat(tile('Revenus encaissés').textContent)).toContain(eur(11000));
    expect(flat(tile('Revenus encaissés').textContent)).toContain(
      `Période précédente : ${eur(10000)} (+10 %)`,
    );
    expect(tile('Rendez-vous honorés')).toHaveTextContent('6');
    expect(flat(tile('Occupation du planning').textContent)).toContain('4,1 %');
    expect(tile('Occupation du planning')).toHaveTextContent('3 h 15 réservées sur 79 h ouvertes');
    expect(flat(tile('Restant à encaisser').textContent)).toContain(eur(3000));
    // Présence et absence, distinguées : 6 honorés, 1 absent.
    expect(flat(tile('Taux de présence').textContent)).toContain('85,7 %');
    expect(flat(tile('Taux de présence').textContent)).toContain(
      'Taux d’absence : 14,3 % · 6 honorés, 1 absent',
    );
    expect(tile('Nouveaux patients')).toHaveTextContent('5 patients actifs');
    // Taux sans donnée : « — », jamais « 0 % ».
    const occupancy = screen.getByRole('heading', {
      name: 'Occupation du planning par praticien',
    }).parentElement!;
    expect(within(occupancy).getByText('Dr Bravo').parentElement).toHaveTextContent('—');
    expect(occupancy).toHaveTextContent('aucun horaire sur la période');
    expect(
      screen.getByRole('heading', { name: 'Revenus par praticien' }).parentElement,
    ).toHaveTextContent('Non précisé');
    // Acte manquant : lien direct vers l'encaissement du rendez-vous.
    const unbilled = screen.getByRole('list', { name: 'Rendez-vous honorés sans acte saisi' });
    expect(within(unbilled).getByRole('link', { name: 'Encaisser' })).toHaveAttribute(
      'href',
      `/patients/${IDS.patient}?encaisser=01a0de00-0000-7000-8000-00000000f001#paiements`,
    );
  });

  it('secrétaire : aucune donnée de revenus affichée (section absente de la réponse)', async () => {
    setup('SECRETARY');
    renderApp('/statistiques');
    await screen.findByText('Rendez-vous honorés', { selector: 'dt' });
    expect(screen.queryByText('Revenus encaissés', { selector: 'dt' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Évolution des revenus encaissés' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Revenus par praticien' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Activité par période' })).toBeInTheDocument();
    expect(flat(tile('Restant à encaisser').textContent)).toContain(eur(3000));
  });

  it('périodes : aujourd’hui, semaine, année, précédente et suivante ; praticien', async () => {
    const calls = setup('DENTIST');
    renderApp('/statistiques');
    await screen.findByText('Rendez-vous honorés', { selector: 'dt' });
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
    const last = () => dashboardCalls(calls).at(-1);
    click('Période précédente');
    await waitFor(() => expect(last()).toBe('/api/dashboard?from=2026-08-01&to=2026-08-31'));
    expect(document.querySelector('p[aria-live]')).toHaveTextContent('août 2026');
    click('Aujourd’hui');
    await waitFor(() => expect(last()).toBe('/api/dashboard?from=2026-09-28&to=2026-09-28'));
    click('Semaine');
    await waitFor(() => expect(last()).toBe('/api/dashboard?from=2026-09-28&to=2026-10-04'));
    expect(screen.getByRole('button', { name: 'Semaine' })).toHaveAttribute('aria-pressed', 'true');
    click('Période suivante');
    await waitFor(() => expect(last()).toBe('/api/dashboard?from=2026-10-05&to=2026-10-11'));
    click('Année');
    await waitFor(() => expect(last()).toBe('/api/dashboard?from=2026-01-01&to=2026-12-31'));
    fireEvent.change(screen.getByLabelText('Praticien'), { target: { value: IDS.bravo } });
    await waitFor(() =>
      expect(last()).toBe(
        `/api/dashboard?from=2026-01-01&to=2026-12-31&practitionerId=${IDS.bravo}`,
      ),
    );
    expect(screen.getByText(/Filtré sur un praticien/)).toBeInTheDocument();
  });

  it('période libre : dates saisies ; période incohérente refusée sans appel au serveur', async () => {
    const calls = setup('DENTIST');
    renderApp('/statistiques');
    await screen.findByText('Rendez-vous honorés', { selector: 'dt' });
    fireEvent.click(screen.getByRole('button', { name: 'Période libre' }));
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-09-10' } });
    await waitFor(() =>
      expect(dashboardCalls(calls).at(-1)).toBe('/api/dashboard?from=2026-09-10&to=2026-09-30'),
    );
    const before = dashboardCalls(calls).length;
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-09-01' } });
    expect(
      await screen.findByText('La date de début doit précéder la date de fin.'),
    ).toBeInTheDocument();
    expect(dashboardCalls(calls)).toHaveLength(before);
  });

  it('graphiques : colonnes au clavier avec leurs valeurs, légende et tableau des valeurs', async () => {
    setup('DENTIST');
    renderApp('/statistiques');
    const revenue = await screen.findByRole('group', { name: 'Évolution des revenus encaissés' });
    const columns = within(revenue)
      .getAllByRole('generic', { hidden: false })
      .filter((e) => e.hasAttribute('tabindex'));
    expect(columns).toHaveLength(3);
    expect(flat(columns[2]!.getAttribute('aria-label'))).toBe(
      `jeudi 3 septembre 2026 : Encaissé ${eur(9000)}`,
    );
    fireEvent.focus(columns[2]!);
    expect(flat(within(revenue.parentElement!).getByRole('status').textContent)).toContain(
      eur(9000),
    );
    const activity = screen.getByRole('group', { name: 'Activité par période' });
    // Plusieurs séries : légende présente.
    expect(activity.closest('figure')).toHaveTextContent('HonorésAbsentsPrévus');
    const table = within(activity.closest('figure')!).getByRole('table', { hidden: true });
    expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(4);
  });

  it('données vides : messages explicites, taux « — »', async () => {
    setup('DENTIST', (call) => {
      const q = new URL(call.url, 'http://x').searchParams;
      const d = dashboard('DENTIST', { from: q.get('from')!, to: q.get('to')! });
      const zero = { start: '2026-09-01', scheduled: 0, completed: 0, noShow: 0, cancelled: 0 };
      return {
        ...d,
        activity: {
          ...d.activity!,
          total: 0,
          completed: 0,
          noShow: 0,
          cancelled: 0,
          scheduled: 0,
          noShowRate: null,
          presenceRate: null,
          cancellationRate: null,
          occupancy: { bookedMinutes: 0, openMinutes: 0, rate: null },
          byPractitioner: [],
          series: [zero],
          topTypes: [],
        },
        revenue: {
          ...d.revenue!,
          totalCents: 0,
          count: 0,
          voided: { amountCents: 0, count: 0 },
          series: [{ start: '2026-09-01', amountCents: 0, count: 0 }],
          byPractitioner: [],
        },
        unbilled: { count: 0, exempt: 0, items: [] },
      };
    });
    renderApp('/statistiques');
    // Évolution et répartition par praticien.
    expect(await screen.findAllByText('Aucun encaissement sur la période.')).toHaveLength(2);
    // Activité par période et types fréquents.
    expect(screen.getAllByText('Aucun rendez-vous sur la période.')).toHaveLength(2);
    expect(tile('Occupation du planning')).toHaveTextContent('—');
    expect(tile('Taux de présence')).toHaveTextContent('—Taux d’absence : —');
    expect(
      screen.getByText('Tous les rendez-vous honorés de la période ont un acte à encaisser.'),
    ).toBeInTheDocument();
  });
});

describe('rendez-vous sans facturation', () => {
  it('depuis la liste des oublis : confirmation, puis mention envoyée au serveur', async () => {
    const target = '01a0de00-0000-7000-8000-00000000f001';
    const calls = setup('SECRETARY', undefined, {
      [`POST /api/appointments/${target}/billing`]: () => ({
        status: 200,
        body: { appointmentId: target, billingExempt: true },
      }),
    });
    const posts = () => calls.filter((c) => c.method === 'POST');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderApp('/statistiques');
    const list = await screen.findByRole('list', { name: 'Rendez-vous honorés sans acte saisi' });
    // Les rendez-vous déjà marqués sont comptés à part.
    expect(
      screen.getByText(/2 rendez-vous honorés marqués « sans facturation », non comptés/),
    ).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: /^Sans facturation : DUPONT Léa/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toMatchObject({
      url: '/api/appointments/01a0de00-0000-7000-8000-00000000f001/billing',
      body: { billingExempt: true },
    });
    // Le tableau de bord est relu.
    await waitFor(() => expect(dashboardCalls(calls).length).toBeGreaterThan(1));
  });
});

describe('accueil : « À suivre »', () => {
  it('dentiste lié à un praticien : indicateurs de sa journée, revenus du jour compris', async () => {
    const calls = setup('DENTIST');
    renderApp('/');
    const section = await screen.findByRole('region', { name: 'À suivre' });
    await within(section).findByText('Encaissé aujourd’hui');
    expect(dashboardCalls(calls)).toContain(
      `/api/dashboard?from=2026-09-28&to=2026-09-28&practitionerId=${IDS.alpha}`,
    );
    expect(section).toHaveTextContent('Rendez-vous des 7 prochains jours5');
    expect(within(section).getByRole('link', { name: 'Voir la liste' })).toHaveAttribute(
      'href',
      '/statistiques?vue=day&du=2026-09-28&au=2026-09-28',
    );
    // « Tout le cabinet » : les indicateurs suivent.
    fireEvent.click(screen.getByRole('button', { name: 'Tout le cabinet' }));
    await waitFor(() =>
      expect(dashboardCalls(calls).at(-1)).toBe('/api/dashboard?from=2026-09-28&to=2026-09-28'),
    );
  });

  it('secrétaire : pas d’indicateur de revenus', async () => {
    setup('SECRETARY');
    renderApp('/');
    const section = await screen.findByRole('region', { name: 'À suivre' });
    await within(section).findByText('Restant à encaisser');
    expect(within(section).queryByText('Encaissé aujourd’hui')).toBeNull();
  });
});

describe('formats', () => {
  it('périodes et tranches', () => {
    expect(formatPeriod({ from: '2026-09-01', to: '2026-09-30' })).toBe('septembre 2026');
    expect(formatPeriod({ from: '2026-01-01', to: '2026-12-31' })).toBe('année 2026');
    expect(formatPeriod({ from: '2026-09-28', to: '2026-10-04' })).toBe(
      'semaine du 28 septembre au 4 octobre 2026',
    );
    expect(formatPeriod({ from: '2026-09-28', to: '2026-09-28' })).toBe('lundi 28 septembre 2026');
    expect(formatPeriod({ from: '2026-09-10', to: '2026-09-30' })).toBe(
      'du 10 septembre 2026 au 30 septembre 2026',
    );
    const q = { from: '2026-10-01', to: '2026-10-21' };
    // Première semaine partielle (du jeudi au dimanche), dernière aussi.
    expect(bucketLabel('2026-10-01', 'week', q)).toBe('du 1 octobre au 4 octobre 2026');
    expect(bucketLabel('2026-10-19', 'week', q)).toBe('du 19 octobre au 21 octobre 2026');
    expect(bucketLabel('2026-09-01', 'month', q)).toBe('septembre 2026');
    expect(tickLabel('2026-09-07', 'day')).toBe('7 sept.');
    expect(tickLabel('2026-09-01', 'month')).toBe('sept.');
  });

  it('taux, durées, variations, axe', () => {
    expect(formatRate(null)).toBe('—');
    expect(flat(formatRate(0))).toBe('0 %');
    expect(flat(formatRate(1 / 7))).toBe('14,3 %');
    expect(formatDuration(195)).toBe('3 h 15');
    expect(formatDuration(4740)).toBe('79 h');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatChange(110, 100)).toBe('+10 %'.replace(' ', ' '));
    expect(flat(formatChange(90, 100))).toBe('−10 %');
    expect(formatChange(5, 0)).toBeNull();
    expect(niceMax(0)).toBe(1);
    expect(niceMax(9000)).toBe(10000);
    expect(niceMax(11000)).toBe(20000);
    expect(niceMax(3)).toBe(5);
  });
});
