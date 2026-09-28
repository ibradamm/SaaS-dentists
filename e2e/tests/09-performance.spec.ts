import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
} from '@playwright/test';
import { setupClinic, signIn, type Clinic } from '../support/app';
import { addDays, nextWorkday, todayIn } from '../support/dates';
import { sql } from '../support/db';
import { ARTIFACTS, BASE_URL } from '../support/env';
import { seedVolume, type Volume } from '../support/volume';

/*
 * Performances mesurées sur la pile de production avec un an d'activité d'un cabinet
 * (5 000 patients, environ 6 000 rendez-vous, actes, paiements, 100 000 entrées de journal) :
 *  - temps d'affichage des pages principales (navigation complète, données comprises) ;
 *  - charge : 20 postes simultanés pendant 30 secondes sur un mélange réaliste
 *    (agenda, recherche, fiche, créneaux, prise et annulation de rendez-vous, tableau de bord).
 * Seuils volontairement larges (machine de CI partagée) ; les valeurs mesurées sont écrites
 * dans e2e/artifacts/performance.json et reprises dans le rapport de phase.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

let clinic: Clinic;
let volume: Volume;
const today = todayIn();
const results: Record<string, unknown> = {};
const PAGE_BUDGET_MS = 4000;
const API_BUDGET_MS = 2000;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  clinic = await setupClinic(browser, 'Cabinet Volumineux');
  const started = Date.now();
  volume = await seedVolume(clinic.id);
  results.volume = { ...volume, seedMs: Date.now() - started };
});

test.afterAll(() => {
  writeFileSync(
    path.join(ARTIFACTS, 'performance.json'),
    `${JSON.stringify({ measuredAt: new Date().toISOString(), ...results }, null, 2)}\n`,
  );
});

test('volume : un an d’activité en base', () => {
  expect(volume.patients).toBe(5000);
  expect(volume.appointments).toBeGreaterThan(5000);
  expect(volume.payments).toBeGreaterThan(3000);
  expect(volume.auditLogs).toBeGreaterThan(90_000);
});

interface Measure {
  page: string;
  readyMs: number;
  api: { url: string; ms: number }[];
}

async function measure(page: Page, name: string, url: string, ready: (p: Page) => Locator) {
  await page.goto('about:blank');
  const started = Date.now();
  await page.goto(url);
  await expect(ready(page).first()).toBeVisible({ timeout: 20_000 });
  const readyMs = Date.now() - started;
  const api = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => new URL(e.name).pathname.startsWith('/api/'))
      .map((e) => {
        const u = new URL(e.name);
        return { url: `${u.pathname}${u.search}`, ms: Math.round(e.duration) };
      }),
  );
  return { page: name, readyMs, api } satisfies Measure;
}

test('pages : affichage complet avec un an de données', async ({ browser }) => {
  const dentist = await signIn(browser, clinic.dentist);
  const admin = clinic.adminPage;
  const [busy] = await sql<{ id: string }>(
    `select patient_id as id from appointments where clinic_id = $1
      group by patient_id order by count(*) desc limit 1`,
    [clinic.id],
  );
  const yearAgo = addDays(today, -364);
  const measures: Measure[] = [
    await measure(admin, 'accueil', '/', (p) => p.getByRole('region', { name: 'À suivre' })),
    await measure(dentist, 'agenda semaine (dentiste)', `/agenda?vue=semaine&date=${today}`, (p) =>
      p.getByRole('button', { name: /\d{2}:\d{2}–\d{2}:\d{2} PATIENT/ }),
    ),
    await measure(admin, 'agenda jour', `/agenda?vue=jour&date=${nextWorkday(today)}`, (p) =>
      p.getByRole('button', { name: /^Dr Denis, \d{2}:\d{2}/ }),
    ),
    await measure(admin, 'liste des patients', '/patients', (p) =>
      p.getByRole('list', { name: 'Liste des patients' }).getByRole('link'),
    ),
    await measure(admin, 'fiche du patient le plus suivi', `/patients/${busy?.id}`, (p) =>
      p.getByRole('heading', { name: 'Rendez-vous' }),
    ),
    await measure(admin, 'à encaisser', '/encaissements', (p) =>
      p.getByRole('list', { name: 'Patients avec un restant dû' }).getByRole('listitem'),
    ),
    await measure(admin, 'revenus sur un an', `/revenus?du=${yearAgo}&au=${today}`, (p) =>
      p.getByText(/^Encaissé du/),
    ),
    await measure(
      admin,
      'statistiques sur un an',
      `/statistiques?vue=custom&du=${yearAgo}&au=${today}`,
      (p) => p.locator('dt', { hasText: 'Revenus encaissés' }),
    ),
    await measure(
      admin,
      'journal sur un mois',
      `/journal?du=${addDays(today, -30)}&au=${today}`,
      (p) => p.getByRole('list', { name: 'Entrées du journal' }).getByRole('listitem'),
    ),
  ];
  // Recherche rapide : de la frappe au résultat affiché.
  await admin.goto('/patients');
  await expect(admin.getByRole('list', { name: 'Liste des patients' })).toBeVisible();
  const started = Date.now();
  await admin.getByRole('searchbox', { name: /^Rechercher \(nom/ }).fill('patient4242');
  await expect(admin.getByRole('link', { name: /PATIENT4242 Volume/ })).toBeVisible();
  const searchMs = Date.now() - started;
  results.pages = measures.map((m) => ({
    page: m.page,
    readyMs: m.readyMs,
    slowestApi: m.api.sort((a, b) => b.ms - a.ms)[0] ?? null,
  }));
  results.search = {
    query: 'patient4242',
    ms: searchMs,
    note: 'frappe → résultat (délai de saisie compris)',
  };
  for (const m of measures) {
    expect({ page: m.page, lent: m.readyMs > PAGE_BUDGET_MS }).toEqual({
      page: m.page,
      lent: false,
    });
    for (const call of m.api) {
      expect({ appel: call.url, lent: call.ms > API_BUDGET_MS }).toEqual({
        appel: call.url,
        lent: false,
      });
    }
  }
  expect(searchMs).toBeLessThan(PAGE_BUDGET_MS);
  await dentist.context().close();
});

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

test('charge : 20 postes simultanés pendant 30 secondes, aucune erreur serveur', async ({
  browser,
}) => {
  const USERS = 20;
  const DURATION_MS = 30_000;
  // Une secrétaire (première connexion faite par l'interface), une session par poste.
  await (await signIn(browser, clinic.secretary)).context().close();
  const { email, password } = clinic.secretary;
  const [meta] = await sql<{ patients: string[]; type: string }>(
    `select (select array_agg(id) from (select id from patients where clinic_id = $1 limit 500) p) as patients,
            (select id from appointment_types where clinic_id = $1 order by name limit 1) as type`,
    [clinic.id],
  );
  const practitioners = [clinic.practitioners.dentist, clinic.practitioners.hygienist];
  const timings = new Map<string, number[]>();
  const failures: string[] = [];
  let conflicts = 0;
  let booked = 0;
  const record = (kind: string, ms: number) => {
    const list = timings.get(kind) ?? [];
    list.push(ms);
    timings.set(kind, list);
  };
  const rand = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;
  const weekStart = today;
  const weekEnd = addDays(today, 6);

  // Connexions l'une après l'autre : une tentative simultanée sur la même adresse est refusée
  // par conception (429, docs/adr/0011) ; la charge mesurée est celle de l'usage, pas du login.
  const sessions: { ctx: APIRequestContext; csrfToken: string }[] = [];
  for (let i = 0; i < USERS; i += 1) {
    const ctx = await request.newContext({ baseURL: BASE_URL });
    const login = await ctx.post('/api/auth/login', { data: { email, password } });
    expect(login.status(), `connexion du poste ${i}`).toBe(200);
    sessions.push({ ctx, csrfToken: ((await login.json()) as { csrfToken: string }).csrfToken });
  }

  async function virtualUser({ ctx, csrfToken }: { ctx: APIRequestContext; csrfToken: string }) {
    const headers = { 'x-csrf-token': csrfToken };
    const call = async (kind: string, run: () => Promise<APIResponse>, ok: number[]) => {
      const t = Date.now();
      try {
        const res = await run();
        record(kind, Date.now() - t);
        if (res.status() === 409 && kind === 'prise de rendez-vous') conflicts += 1;
        else if (!ok.includes(res.status())) failures.push(`${kind} : ${res.status()}`);
        return res;
      } catch (error) {
        failures.push(`${kind} : ${(error as Error).message}`);
        return null;
      }
    };
    const end = Date.now() + DURATION_MS;
    while (Date.now() < end) {
      const practitionerId = rand(practitioners);
      await call(
        'agenda (semaine)',
        () =>
          ctx.get(
            `/api/appointments?from=${weekStart}&to=${weekEnd}&practitionerId=${practitionerId}`,
          ),
        [200],
      );
      await call(
        'recherche de patient',
        () => ctx.get(`/api/patients?q=patient${Math.floor(Math.random() * 5000) + 1}`),
        [200],
      );
      const patientId = rand(meta!.patients);
      await call('fiche patient', () => ctx.get(`/api/patients/${patientId}`), [200]);
      const day = nextWorkday(addDays(today, Math.floor(Math.random() * 50)));
      await call(
        'créneaux libres',
        () =>
          ctx.get(
            `/api/availability/slots?practitionerId=${practitionerId}&from=${day}&to=${day}&durationMinutes=30`,
          ),
        [200],
      );
      const hour = rand(['09', '10', '11', '14', '15', '16', '17']);
      const minute = rand(['00', '30']);
      const created = await call(
        'prise de rendez-vous',
        () =>
          ctx.post('/api/appointments', {
            headers,
            data: {
              practitionerId,
              patientId,
              appointmentTypeId: meta!.type,
              start: `${day}T${hour}:${minute}`,
              durationMinutes: 30,
            },
          }),
        [201],
      );
      if (created?.status() === 201) {
        booked += 1;
        const body = (await created.json()) as { id: string; version: number };
        await call(
          'annulation',
          () =>
            ctx.post(`/api/appointments/${body.id}/status`, {
              headers,
              data: { version: body.version, status: 'CANCELLED', reason: null },
            }),
          [200],
        );
      }
      await call(
        'tableau de bord (mois)',
        () => ctx.get(`/api/dashboard?from=${today.slice(0, 8)}01&to=${today}`),
        [200],
      );
    }
    await ctx.dispose();
  }

  const started = Date.now();
  await Promise.all(sessions.map((session) => virtualUser(session)));
  const elapsed = Date.now() - started;
  const summary = [...timings.entries()].map(([kind, list]) => {
    const sorted = [...list].sort((a, b) => a - b);
    return {
      kind,
      count: list.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1] ?? 0,
    };
  });
  const total = summary.reduce((n, s) => n + s.count, 0);
  results.load = {
    users: USERS,
    durationMs: elapsed,
    requests: total,
    throughputPerSecond: Math.round((total / elapsed) * 1000),
    booked,
    slotConflicts: conflicts,
    failures: failures.slice(0, 20),
    failureCount: failures.length,
    byKind: summary,
  };
  test
    .info()
    .annotations.push({ type: 'charge', description: JSON.stringify(results.load, null, 1) });
  expect(failures).toEqual([]);
  // Invariant : jamais deux rendez-vous qui se chevauchent pour un praticien.
  const [overlap] = await sql<{ n: number }>(
    `select count(*)::int as n from appointments a join appointments b
       on a.practitioner_id = b.practitioner_id and a.id < b.id
      and a.occupies_slot and b.occupies_slot
      and tstzrange(a.start_at, a.end_at) && tstzrange(b.start_at, b.end_at)
      where a.clinic_id = $1 and b.clinic_id = $1`,
    [clinic.id],
  );
  expect(overlap?.n).toBe(0);
  for (const s of summary) {
    expect({ appel: s.kind, p95TropLent: s.p95 > API_BUDGET_MS }).toEqual({
      appel: s.kind,
      p95TropLent: false,
    });
  }
});
