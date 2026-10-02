import { expect, test } from '@playwright/test';
import {
  createPatient,
  createUserAccount,
  login,
  nav,
  setupClinic,
  signIn,
  totpFor,
  type Clinic,
} from '../support/app';
import { sql } from '../support/db';
import { PATIENTS } from '../support/sentinels';

/*
 * Authentification de bout en bout : échecs et verrouillage, double authentification,
 * déconnexion, session révoquée ou expirée, changement d'utilisateur ou de cabinet sur un même
 * poste, réinitialisations par l'administrateur.
 */
let clinic: Clinic;
test.beforeAll(async ({ browser }) => {
  clinic = await setupClinic(browser, 'Cabinet Authentification');
});

const incorrect = 'Adresse e-mail ou mot de passe incorrect';

test('mot de passe faux : message neutre ; verrouillage après 10 échecs, même le bon est refusé', async ({
  page,
}) => {
  const user = await createUserAccount(clinic.adminPage, 'SECRETARY', 'Victor Verrou');
  await page.goto('/connexion');
  for (let i = 0; i < 10; i++) {
    await page.getByLabel('Adresse e-mail').fill(user.email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(`faux-${i}`);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('alert')).toHaveText(incorrect);
  }
  await page.getByLabel('Mot de passe', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Trop de tentatives. Réessayez dans quelques minutes.',
  );
  const [row] = await sql<{ locked: boolean }>(
    'SELECT locked_until > now() AS locked FROM users WHERE email = $1',
    [user.email],
  );
  expect(row?.locked).toBe(true);
  // Même message pour une adresse inconnue : l'existence d'un compte n'est pas révélée.
  await page.getByLabel('Adresse e-mail').fill('personne@e2e.test');
  await page.getByLabel('Mot de passe', { exact: true }).fill('x');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toHaveText(incorrect);
});

test('double authentification : code faux refusé, bon code accepté', async ({ browser }) => {
  const dentist = await signIn(browser, clinic.dentist);
  await dentist.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(dentist.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await dentist.getByLabel('Adresse e-mail').fill(clinic.dentist.email);
  await dentist.getByLabel('Mot de passe', { exact: true }).fill(clinic.dentist.password);
  await dentist.getByRole('button', { name: 'Se connecter' }).click();
  await dentist.getByLabel('Code', { exact: true }).fill('000000');
  await dentist.getByRole('button', { name: 'Valider' }).click();
  await expect(dentist.getByRole('alert')).toHaveText('Code invalide ou déjà utilisé');
  // Pendant l'étape du code, aucune page de l'application n'est accessible.
  await dentist.goto('/patients');
  await expect(dentist.getByRole('heading', { name: 'Code de vérification' })).toBeVisible();
  await dentist.getByLabel('Code', { exact: true }).fill(await totpFor(clinic.dentist));
  await dentist.getByRole('button', { name: 'Valider' }).click();
  await expect(dentist.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
  await dentist.context().close();
});

test('déconnexion : retour à la connexion, plus aucune page accessible', async ({ browser }) => {
  const page = await signIn(browser, clinic.secretary);
  await nav(page).getByRole('link', { name: 'Patients' }).click();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  await page.goto('/patients');
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.includes('dental_session'))).toEqual([]);
  await page.context().close();
});

test('session révoquée ou inactive depuis plus d’une heure : retour à la connexion', async ({
  browser,
}) => {
  for (const change of [
    'revoked_at = now()',
    // Inactivité : dernière activité il y a deux heures (limite : 60 minutes).
    "last_seen_at = now() - interval '2 hours'",
  ]) {
    const page = await signIn(browser, clinic.secretary);
    await sql(
      `UPDATE sessions SET ${change}
        WHERE user_id = (SELECT id FROM users WHERE email = $1) AND revoked_at IS NULL`,
      [clinic.secretary.email],
    );
    // Navigation dans l'application (si elle n'a pas déjà constaté la fin de session).
    await nav(page)
      .getByRole('link', { name: 'Patients' })
      .click({ timeout: 3_000 })
      .catch(() => undefined);
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
    await page.context().close();
  }
});

test('changement d’utilisateur sur le même poste : rien de la session précédente', async ({
  browser,
}) => {
  const other = await setupClinic(browser, 'Cabinet Voisin');
  const [last, first] = PATIENTS.g;
  await createPatient(clinic.adminPage, last, first);
  const page = await signIn(browser, clinic.secretary);
  await nav(page).getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('list', { name: 'Liste des patients' })).toContainText(
    last.toUpperCase(),
  );
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  // Même onglet : l'administratrice d'un autre cabinet se connecte.
  await login(page, other.admin);
  await expect(page.getByText(other.name)).toBeVisible();
  await nav(page).getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();
  await expect(page.getByText(last.toUpperCase())).toHaveCount(0);
  await page.getByPlaceholder('Rechercher un patient…').fill(last.slice(0, 5));
  await expect(page.getByRole('link', { name: new RegExp(last.toUpperCase()) })).toHaveCount(0);
  await page.context().close();
  await other.adminPage.context().close();
});

test('compte de deux cabinets : choix du cabinet à la connexion, données du cabinet choisi', async ({
  browser,
}) => {
  const second = await setupClinic(browser, 'Cabinet Second');
  const [last, first] = PATIENTS.e;
  await createPatient(second.adminPage, last, first);
  const user = await createUserAccount(clinic.adminPage, 'SECRETARY', 'Camille Double');
  await sql(
    `INSERT INTO clinic_memberships (id, clinic_id, user_id, role)
     VALUES (gen_random_uuid(), $1, $2, 'SECRETARY')`,
    [second.id, user.id],
  );
  const page = await (await browser.newContext()).newPage();
  await login(page, user, { clinic: second.name });
  await expect(page.getByText(second.name)).toBeVisible();
  await nav(page).getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('list', { name: 'Liste des patients' })).toContainText(
    last.toUpperCase(),
  );
  // Changer de cabinet : se déconnecter, puis choisir l'autre.
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await login(page, user, { clinic: clinic.name });
  await expect(page.getByText(clinic.name)).toBeVisible();
  await nav(page).getByRole('link', { name: 'Patients' }).click();
  await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible();
  await expect(page.getByText(last.toUpperCase())).toHaveCount(0);
  await page.context().close();
  await second.adminPage.context().close();
});

test('réinitialisations par l’administrateur : double authentification, mot de passe', async ({
  browser,
}) => {
  const dentist = await createUserAccount(clinic.adminPage, 'DENTIST', 'Rémi Réinit');
  const dentistPage = await signIn(browser, dentist);
  await dentistPage.context().close();
  const admin = clinic.adminPage;
  await admin.goto('/utilisateurs');
  const row = admin
    .getByRole('list', { name: 'Liste des utilisateurs' })
    .getByRole('listitem')
    .filter({ hasText: 'Rémi Réinit' });
  await row.getByRole('button', { name: 'Réinitialiser la double authentification' }).click();
  await expect(
    row.getByRole('button', { name: 'Réinitialiser la double authentification' }),
  ).toHaveCount(0);
  // Nouvelle connexion : la double authentification est à remettre en place.
  const again = await (await browser.newContext()).newPage();
  await again.goto('/connexion');
  await again.getByLabel('Adresse e-mail').fill(dentist.email);
  await again.getByLabel('Mot de passe', { exact: true }).fill(dentist.password);
  await again.getByRole('button', { name: 'Se connecter' }).click();
  await expect(again.getByRole('button', { name: 'Commencer' })).toBeVisible();
  await again.context().close();

  await row.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click();
  const shown = admin.getByText('Mot de passe temporaire pour').locator('..');
  const temporary = (await shown.locator('code').innerText()).trim();
  await admin.getByRole('button', { name: "J'ai transmis le mot de passe" }).click();
  const [state] = await sql<{ must: boolean; sessions: number }>(
    `SELECT u.must_change_password AS must,
            (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL) AS sessions
       FROM users u WHERE u.email = $1`,
    [dentist.email],
  );
  expect(state).toEqual({ must: true, sessions: 0 });
  expect(temporary).toMatch(/^\S{16}$/);
});
