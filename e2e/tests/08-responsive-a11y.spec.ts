import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  api,
  createPatient,
  DESKTOP,
  horizontalOverflow,
  PHONE,
  setupClinic,
  signIn,
  TABLET,
  type Clinic,
  type Role,
} from '../support/app';
import { todayIn } from '../support/dates';
import { PATIENTS } from '../support/sentinels';

/*
 * Toutes les pages principales, pour chaque rôle, en téléphone, tablette et ordinateur :
 * aucun défilement horizontal, et aucune violation « grave » ou « critique » des règles WCAG
 * 2.1 A/AA vérifiables automatiquement (axe-core). Les violations mineures ou modérées sont
 * relevées dans le rapport. Un contrôle automatique ne remplace pas un audit manuel.
 */
let clinic: Clinic;
let patientId = '';
const pages: Partial<Record<Role, Page>> = {};

test.beforeAll(async ({ browser }) => {
  clinic = await setupClinic(browser, 'Cabinet Accessible');
  patientId = await createPatient(clinic.adminPage, ...PATIENTS.a);
  // Pages avec du contenu : un rendez-vous aujourd'hui (agenda, accueil), un acte partiellement
  // payé (fiche, « À encaisser », revenus, statistiques).
  const appointment = await api<{ id: string }>(clinic.adminPage, 'POST', '/api/appointments', {
    practitionerId: clinic.practitioners.dentist,
    patientId,
    appointmentTypeId: clinic.types.consultation,
    start: `${todayIn()}T10:00`,
    allowOutsideAvailability: true,
  });
  expect(appointment.status).toBe(201);
  const charge = await api(clinic.adminPage, 'POST', '/api/charges', {
    idempotencyKey: randomUUID(),
    patientId,
    appointmentId: appointment.body.id,
    label: 'Consultation',
    amountCents: 6000,
    payment: { amountCents: 2000, method: 'CARD' },
  });
  expect(charge.status).toBe(201);
  pages.ADMIN = clinic.adminPage;
  pages.DENTIST = await signIn(browser, clinic.dentist);
  pages.SECRETARY = await signIn(browser, clinic.secretary);
});

const COMMON = ['/', '/agenda', '/patients', '/encaissements', '/statistiques', '/disponibilites'];
const ROUTES: Record<Role, string[]> = {
  SECRETARY: [...COMMON, '/patients/nouveau', 'PATIENT'],
  DENTIST: [...COMMON, '/revenus', 'PATIENT'],
  ADMIN: [
    ...COMMON,
    '/revenus',
    'PATIENT',
    '/patients/import',
    '/cabinet',
    '/cabinet/praticiens',
    '/cabinet/types-de-rendez-vous',
    '/utilisateurs',
    '/journal',
  ],
};
const VIEWPORTS = { téléphone: PHONE, tablette: TABLET, ordinateur: DESKTOP };

async function open(page: Page, route: string) {
  await page.goto(route === 'PATIENT' ? `/patients/${patientId}` : route);
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}

for (const role of ['SECRETARY', 'DENTIST', 'ADMIN'] as const) {
  test(`${role} : pages lisibles sur téléphone, tablette et ordinateur`, async () => {
    const page = pages[role]!;
    for (const [name, size] of Object.entries(VIEWPORTS)) {
      await page.setViewportSize(size);
      for (const route of ROUTES[role]) {
        await open(page, route);
        expect({ écran: name, route, débordement: await horizontalOverflow(page) }).toEqual({
          écran: name,
          route,
          débordement: 0,
        });
      }
    }
    await page.setViewportSize(DESKTOP);
  });

  test(`${role} : aucune violation grave ou critique (axe, WCAG 2.1 AA)`, async () => {
    const page = pages[role]!;
    const serious: string[] = [];
    const minor: string[] = [];
    for (const size of [PHONE, DESKTOP]) {
      await page.setViewportSize(size);
      for (const route of ROUTES[role]) {
        await open(page, route);
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        for (const v of result.violations) {
          const line = `${size.width}px ${route} : ${v.id} (${v.impact}) × ${v.nodes.length} — ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join(' | ')}`;
          (v.impact === 'serious' || v.impact === 'critical' ? serious : minor).push(line);
        }
      }
    }
    await page.setViewportSize(DESKTOP);
    test.info().annotations.push({
      type: 'axe : violations mineures ou modérées',
      description: minor.length === 0 ? 'aucune' : minor.join('\n'),
    });
    expect(serious).toEqual([]);
  });
}

async function seriousViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

test('panneaux et formulaires ouverts (agenda, encaissement) : aucune violation grave', async () => {
  const page = pages.SECRETARY!;
  const found: string[] = [];
  for (const size of [PHONE, DESKTOP]) {
    await page.setViewportSize(size);
    await page.goto(`/agenda?vue=jour&date=${todayIn()}`);
    await page
      .getByRole('button', { name: /10:00–10:30 AUBERTIN Léonie/ })
      .first()
      .click();
    await expect(page.getByRole('complementary', { name: 'Rendez-vous' })).toBeVisible();
    found.push(...(await seriousViolations(page)).map((v) => `${size.width}px détail : ${v}`));
    await page.goto(`/agenda?vue=jour&date=${todayIn()}`);
    await page.getByRole('button', { name: 'Nouveau rendez-vous' }).click();
    await expect(page.getByRole('complementary', { name: 'Nouveau rendez-vous' })).toBeVisible();
    found.push(...(await seriousViolations(page)).map((v) => `${size.width}px création : ${v}`));
    await page.goto(`/patients/${patientId}`);
    await page
      .getByRole('region', { name: 'Paiements' })
      .getByRole('button', { name: 'Encaisser : Consultation' })
      .click();
    await expect(page.getByRole('form', { name: 'Encaisser : Consultation' })).toBeVisible();
    found.push(
      ...(await seriousViolations(page)).map((v) => `${size.width}px encaissement : ${v}`),
    );
  }
  await page.setViewportSize(DESKTOP);
  expect(found).toEqual([]);
});

test('page de connexion : lisible sur téléphone et sans violation grave', async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: PHONE })).newPage();
  await page.goto('/connexion');
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await seriousViolations(page)).toEqual([]);
  await page.context().close();
});
