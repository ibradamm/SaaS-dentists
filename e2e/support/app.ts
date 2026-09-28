import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  expect,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { generate } from 'otplib';
import { todayIn } from './dates';
import { SERVER_DIST, databaseUrls } from './env';

export type Role = 'ADMIN' | 'DENTIST' | 'SECRETARY';

/** Compte de test ; le secret TOTP est celui affiché à l'utilisateur lors de l'activation. */
export interface Account {
  email: string;
  password: string;
  fullName: string;
  role: Role;
  temporary: boolean;
  totpSecret?: string;
  lastStep?: number;
}

export const NEW_PASSWORD = 'phrase secrète de test e2e';
export const PHONE = { width: 390, height: 844 };
export const TABLET = { width: 820, height: 1180 };
export const DESKTOP = { width: 1280, height: 900 };

export const uniqueEmail = (prefix: string) =>
  `${prefix}.${randomBytes(4).toString('hex')}@e2e.test`;

function adminCli(script: string, args: string[]): string {
  return execFileSync('node', [path.join(SERVER_DIST, `${script}.js`), ...args], {
    env: { ...process.env, APP_ENV: 'test', DATABASE_MIGRATION_URL: databaseUrls().ownerUrl },
    encoding: 'utf8',
  });
}

/** Nouveau cabinet, par la commande d'administration de production. */
export function createClinic(name: string, timezone = 'Europe/Paris'): string {
  const out = adminCli('create-clinic', [
    '--name',
    name,
    '--timezone',
    timezone,
    '--locale',
    'fr-FR',
    '--currency',
    'EUR',
    '--country',
    'FR',
  ]);
  const id = /Cabinet créé : ([0-9a-f-]{36})/.exec(out)?.[1];
  if (!id) throw new Error(`Cabinet non créé : ${out}`);
  return id;
}

/** Premier administrateur, par la commande de production (mot de passe temporaire). */
export function createAdmin(clinicId: string, fullName = 'Anne Admin'): Account {
  const email = uniqueEmail('admin');
  const out = adminCli('create-admin', [
    '--clinic',
    clinicId,
    '--email',
    email,
    '--name',
    fullName,
  ]);
  const password = /Mot de passe temporaire \(affiché une seule fois\) : (\S+)/.exec(out)?.[1];
  if (!password) throw new Error('Mot de passe temporaire absent');
  return { email, password, fullName, role: 'ADMIN', temporary: true };
}

/**
 * Code TOTP utilisable maintenant : le serveur accepte le pas courant à ±1 près, mais jamais
 * un pas déjà utilisé. Jamais le pas précédent : si une frontière de 30 s passe entre la
 * génération et la vérification, il serait à deux pas (refus observé en CI). Attend le pas
 * suivant si nécessaire (au plus 30 s).
 */
export async function totpFor(account: Account): Promise<string> {
  if (!account.totpSecret) throw new Error('Compte sans double authentification');
  for (;;) {
    const now = Math.floor(Date.now() / 1000 / 30);
    const step = Math.max(now, (account.lastStep ?? -Infinity) + 1);
    if (step <= now + 1) {
      account.lastStep = step;
      return generate({ secret: account.totpSecret, epoch: step * 30 });
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

async function fillCredentials(page: Page, account: Account) {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail').fill(account.email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

/**
 * Connexion par l'interface. Première connexion : mot de passe imposé, puis mise en place de
 * la double authentification (administrateur, dentiste). Ensuite : code TOTP.
 */
export async function login(page: Page, account: Account, options: { clinic?: string } = {}) {
  await fillCredentials(page, account);
  if (options.clinic) {
    await page.getByRole('group', { name: 'Cabinet' }).getByLabel(options.clinic).check();
    await page.getByRole('button', { name: 'Se connecter' }).click();
  }
  if (account.temporary) {
    await expect(
      page.getByRole('heading', { name: 'Choisissez votre mot de passe' }),
    ).toBeVisible();
    await page.getByLabel(/Mot de passe actuel/).fill(account.password);
    await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
    await page.getByLabel('Confirmation').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    account.password = NEW_PASSWORD;
    account.temporary = false;
    if (account.role !== 'SECRETARY') {
      await page.getByRole('button', { name: 'Commencer' }).click();
      account.totpSecret = (await page.locator('code').innerText()).trim();
      await page.getByLabel("Code affiché par l'application").fill(await totpFor(account));
      await page.getByRole('button', { name: 'Activer' }).click();
    }
  } else if (account.totpSecret) {
    await expect(page.getByRole('heading', { name: 'Code de vérification' })).toBeVisible();
    await page.getByLabel('Code', { exact: true }).fill(await totpFor(account));
    await page.getByRole('button', { name: 'Valider' }).click();
  }
  await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
}

/**
 * Enregistre dans la page toute violation de la politique de sécurité du contenu (CSP) : une
 * ressource bloquée peut passer inaperçue (style, image), la liste doit rester vide.
 */
export async function watchCsp(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __csp?: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__csp?.push(
        `${e.effectiveDirective} ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`,
      );
    });
  });
}

export function cspViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

/** Nouveau poste (contexte isolé) connecté avec ce compte. */
export async function signIn(
  browser: Browser,
  account: Account,
  options: BrowserContextOptions & { clinic?: string } = {},
): Promise<Page> {
  const { clinic, ...contextOptions } = options;
  const context = await browser.newContext(contextOptions);
  await watchCsp(context);
  const page = await context.newPage();
  // Les confirmations (window.confirm) sont acceptées, comme par un utilisateur.
  page.on('dialog', (dialog) => void dialog.accept());
  await login(page, account, clinic ? { clinic } : {});
  return page;
}

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

/** Appel de l'API depuis la page connectée (cookie de session, jeton CSRF de la session). */
export async function api<T = unknown>(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return page.evaluate(
    async ([method, url, body]) => {
      const csrf = (await (await fetch('/api/auth/csrf')).json()) as { csrfToken: string };
      const r = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf.csrfToken },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: (await r.json().catch(() => null)) as T };
    },
    [method, url, body] as const,
  );
}

export async function createUserAccount(
  adminPage: Page,
  role: Role,
  fullName: string,
): Promise<Account & { id: string }> {
  const email = uniqueEmail(role.toLowerCase());
  const res = await api<{ user: { id: string }; temporaryPassword: string }>(
    adminPage,
    'POST',
    '/api/users',
    { email, fullName, role },
  );
  expect(res.status).toBe(201);
  return {
    id: res.body.user.id,
    email,
    password: res.body.temporaryPassword,
    fullName,
    role,
    temporary: true,
  };
}

const WEEK = [1, 2, 3, 4, 5].flatMap((weekday) => [
  { weekday, start: '09:00', end: '12:00' },
  { weekday, start: '14:00', end: '18:00' },
]);

export interface Clinic {
  id: string;
  name: string;
  admin: Account;
  dentist: Account & { id: string };
  secretary: Account & { id: string };
  adminPage: Page;
  practitioners: { dentist: string; hygienist: string };
  types: { consultation: string; scaling: string };
}

/**
 * Cabinet prêt à l'emploi, préparé par l'API (le parcours de démonstration fait la même chose
 * par l'interface) : administrateur connecté, dentiste et secrétaire créés (première connexion
 * à faire), deux praticiens, deux types, horaires du lundi au vendredi à partir d'aujourd'hui.
 */
export async function setupClinic(browser: Browser, name: string): Promise<Clinic> {
  const id = createClinic(name);
  const admin = createAdmin(id);
  const adminPage = await signIn(browser, admin);
  const dentist = await createUserAccount(adminPage, 'DENTIST', 'Denis Dentiste');
  const secretary = await createUserAccount(adminPage, 'SECRETARY', 'Sarah Secrétaire');
  const practitioner = async (displayName: string, userId: string | null, color: string) => {
    const r = await api<{ id: string }>(adminPage, 'POST', '/api/practitioners', {
      displayName,
      color,
      userId,
    });
    expect(r.status).toBe(201);
    const schedule = await api(adminPage, 'PUT', `/api/practitioners/${r.body.id}/schedules`, {
      validFrom: todayIn(),
      basePeriod: null,
      intervals: WEEK,
    });
    expect(schedule.status).toBeLessThan(300);
    return r.body.id;
  };
  const type = async (typeName: string, durationMinutes: number) => {
    const r = await api<{ id: string }>(adminPage, 'POST', '/api/appointment-types', {
      name: typeName,
      durationMinutes,
      color: '#10b981',
    });
    expect(r.status).toBe(201);
    return r.body.id;
  };
  return {
    id,
    name,
    admin,
    dentist,
    secretary,
    adminPage,
    practitioners: {
      dentist: await practitioner('Dr Denis', dentist.id, '#0ea5e9'),
      hygienist: await practitioner('Hygiéniste Hélène', null, '#a855f7'),
    },
    types: {
      consultation: await type('Consultation', 30),
      scaling: await type('Détartrage', 45),
    },
  };
}

export async function createPatient(
  page: Page,
  lastName: string,
  firstName: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const r = await api<{ id: string }>(page, 'POST', '/api/patients', {
    lastName,
    firstName,
    contacts: [{ phone: '06 12 34 56 78' }],
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.id;
}

/** Aucun défilement horizontal de la page (largeur utile respectée). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });

/** Choisit l'option d'une liste dont le texte contient `text` (libellés enrichis). */
export async function selectContaining(select: Locator, text: string) {
  const value = await select.evaluate(
    (s, t) =>
      [...(s as HTMLSelectElement).options].find((o) => o.textContent?.includes(t))?.value ?? null,
    text,
  );
  if (value === null) throw new Error(`Option « ${text} » absente`);
  await select.selectOption(value);
}
