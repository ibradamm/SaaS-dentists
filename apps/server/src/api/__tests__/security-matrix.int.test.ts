import { randomBytes, randomUUID } from 'node:crypto';
import { PERMISSIONS, ROLES, roleHasPermission, type Role } from '@dental/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_WEB_ORIGIN, browser, buildTestApp } from '../../../test/app';
import { createUser, enableMfa, testClock, totpAt } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import type { Clinic } from '../../db/schema';
import { createSecretBox } from '../../lib/secret-box';
import type { AuthService } from '../../modules/auth/auth.service';
import { registerAuth, routeInventory, type RouteInventoryEntry } from '../auth-plugin';

type Browser = ReturnType<typeof browser>;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const UNSAFE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** URL concrète d'une route : chaque paramètre reçoit un identifiant inexistant. */
const concrete = (url: string) => url.replace(/:[A-Za-z]+/g, () => randomUUID());
const label = (r: RouteInventoryEntry) => `${r.method} ${r.url}`;

/**
 * Revue systématique des routes (docs/adr/0011) : chaque route enregistrée est vérifiée, pas
 * seulement celles auxquelles un test pense. Une nouvelle route entre automatiquement dans la
 * matrice.
 */
describe('sécurité HTTP : matrice de toutes les routes', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  const clock = testClock(new Date('2026-09-28T08:00:00Z'));
  const secretBox = createSecretBox(randomBytes(32));
  let app: FastifyInstance;
  let clinic: Clinic;
  let routes: RouteInventoryEntry[];
  const sessions: Partial<Record<Role, Browser>> = {};

  async function signedIn(role: Role): Promise<Browser> {
    const user = await createUser(t.ownerDb, clinic.id, role);
    const secret =
      role === 'SECRETARY' ? null : await enableMfa(t.ownerDb, clinic.id, user.id, secretBox);
    const b = browser(app);
    await b.login(user.email, user.password);
    if (secret) {
      clock.advanceSeconds(30);
      await b.post('/api/auth/mfa/verify', { code: await totpAt(secret, clock.epochSeconds()) });
    }
    return b;
  }

  /** Requête d'un navigateur connecté ; HEAD est vérifié avec GET, dont il reprend la route. */
  function send(b: Browser, method: string, url: string, headers: Record<string, string> = {}) {
    const m = (method === 'HEAD' ? 'GET' : method) as Method;
    if (m === 'GET') return b.get(url, headers);
    if (m === 'DELETE') return b.delete(url, headers);
    if (m === 'POST') return b.post(url, {}, headers);
    if (m === 'PATCH') return b.patch(url, {}, headers);
    return b.put(url, {}, headers);
  }

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
    app = await buildTestApp(t.appPool, { now: clock.now, secretBox });
    routes = [...routeInventory(app)];
    for (const role of ROLES) sessions[role] = await signedIn(role);
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  it('inventaire : routes publiques connues, toutes les autres sous /api', () => {
    expect(routes.length).toBeGreaterThan(60);
    expect(
      routes
        .filter((r) => r.access.public)
        .map(label)
        .sort(),
    ).toEqual([
      'GET /health/live',
      'GET /health/ready',
      'HEAD /health/live',
      'HEAD /health/ready',
      'POST /api/auth/login',
    ]);
    expect(routes.filter((r) => !r.url.startsWith('/api/') && !r.access.public)).toEqual([]);
    // Toute permission citée par une route existe dans le catalogue.
    const cited = routes.flatMap((r) => [
      ...(r.access.permission ? [r.access.permission] : []),
      ...(r.access.anyPermission ?? []),
    ]);
    expect(cited.filter((p) => !PERMISSIONS.includes(p))).toEqual([]);
  });

  it('une route sans politique d’accès est refusée au démarrage', async () => {
    const bare = Fastify();
    registerAuth(bare, {
      auth: {} as AuthService,
      cookies: { secure: false },
      webOrigin: TEST_WEB_ORIGIN,
    });
    expect(() => bare.get('/api/oubli', () => 'ouvert')).toThrow(/sans politique d'accès/);
    expect(() => bare.get('/api/vide', { config: { access: {} } }, () => 'ouvert')).toThrow(
      /sans politique d'accès/,
    );
    await bare.close();
  });

  it('sans session : 401 partout hors routes publiques, avant toute lecture du corps', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.access.public)) {
      const res = await app.inject({
        method: r.method as Method,
        url: concrete(r.url),
        headers: UNSAFE.has(r.method)
          ? { origin: TEST_WEB_ORIGIN, 'content-type': 'application/json' }
          : {},
        // Corps invalide : un 400 prouverait qu'il a été analysé avant l'authentification.
        ...(UNSAFE.has(r.method) ? { payload: '{corps invalide' } : {}),
      });
      if (res.statusCode !== 401) failures.push(`${label(r)} → ${res.statusCode}`);
    }
    expect(failures).toEqual([]);
  });

  it('CSRF : toute route modifiante exige le jeton de la session et la bonne origine', async () => {
    const admin = sessions.ADMIN!;
    const failures: string[] = [];
    for (const r of routes.filter((x) => UNSAFE.has(x.method))) {
      const url = concrete(r.url);
      const foreign = await send(admin, r.method, url, { origin: 'https://attaquant.example' });
      if (foreign.json<{ error?: { code?: string } }>().error?.code !== 'CSRF_INVALID') {
        failures.push(`${label(r)} origine étrangère → ${foreign.statusCode}`);
      }
      if (r.access.public) continue;
      for (const token of ['', 'faux-jeton']) {
        const res = await send(admin, r.method, url, { 'x-csrf-token': token });
        if (res.json<{ error?: { code?: string } }>().error?.code !== 'CSRF_INVALID') {
          failures.push(`${label(r)} jeton « ${token} » → ${res.statusCode}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(ROLES)('%s : 403 sur chaque route dont il n’a pas la permission', async (role) => {
    const b = sessions[role]!;
    const failures: string[] = [];
    for (const r of routes) {
      const required = r.access.permission ? [r.access.permission] : r.access.anyPermission;
      if (!required || required.some((p) => roleHasPermission(role, p))) continue;
      const res = await send(b, r.method, concrete(r.url));
      if (
        res.statusCode !== 403 ||
        res.json<{ error: { code: string } }>().error.code !== 'FORBIDDEN'
      ) {
        failures.push(`${label(r)} → ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('entrées hostiles sur toutes les routes : jamais d’erreur 500, aucun détail technique renvoyé', async () => {
    // Identifiants malformés, injections, chemins, corps de mauvais type, pollution de
    // prototype, chaînes de requête incohérentes : refus propre (4xx) partout.
    const PARAMS = [
      'pas-un-uuid',
      "1' OR '1'='1",
      '..%2F..%2Fetc%2Fpasswd',
      '%00',
      'a'.repeat(300),
    ];
    const BODIES: unknown[] = [
      [],
      { __proto__: { pollue: true }, constructor: { prototype: { pollue: true } } },
      JSON.parse('{"__proto__": {"pollue": true}}'),
      {
        id: {},
        email: ['x'],
        amountCents: '1e309',
        start: '2026-02-30T25:61',
        version: -1,
        content: 'x'.repeat(100_000),
      },
    ];
    const QUERY =
      '?from=2026-02-30&to=pas-une-date&limit=-5&offset=1e309&q=%27%3B--&practitionerId=x&status=ZZZ&includeCancelled=peut-etre';
    const leaks = /select |insert |update |\bat \w+ \(|node_modules|\/home\/|stack|Error:/i;
    const failures: string[] = [];
    for (const role of ['ADMIN', 'DENTIST'] as const) {
      const b = await signedIn(role);
      for (const r of routes) {
        if (r.url.startsWith('/api/auth/') || r.access.public || r.method === 'HEAD') continue;
        const required = r.access.permission ? [r.access.permission] : r.access.anyPermission;
        if (required && !required.some((p) => roleHasPermission(role, p))) continue;
        const attempts: { url: string; body?: unknown }[] = [];
        const hasParams = /:[A-Za-z]+/.test(r.url);
        for (const value of hasParams ? PARAMS : []) {
          attempts.push({ url: r.url.replace(/:[A-Za-z]+/g, value) });
        }
        if (r.method === 'GET') attempts.push({ url: `${concrete(r.url)}${QUERY}` });
        if (UNSAFE.has(r.method)) {
          for (const body of BODIES) attempts.push({ url: concrete(r.url), body });
        }
        for (const attempt of attempts) {
          const m = r.method as Method;
          const res =
            m === 'GET'
              ? await b.get(attempt.url)
              : m === 'DELETE'
                ? await b.delete(attempt.url)
                : m === 'POST'
                  ? await b.post(attempt.url, attempt.body ?? {})
                  : m === 'PATCH'
                    ? await b.patch(attempt.url, attempt.body ?? {})
                    : await b.put(attempt.url, attempt.body ?? {});
          const where = `${role} ${label(r)} ${attempt.url.slice(0, 60)}`;
          if (res.statusCode >= 500) failures.push(`${where} → ${res.statusCode}`);
          if (res.statusCode >= 400 && leaks.test(res.body))
            failures.push(`${where} : détail renvoyé`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect((Object.prototype as Record<string, unknown>).pollue).toBeUndefined();
  });

  it('étape d’authentification en cours : seules les routes de cette étape répondent', async () => {
    const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY', { mustChangePassword: true });
    const b = browser(app);
    expect((await b.login(user.email, user.password)).json()).toMatchObject({
      restriction: 'PASSWORD_CHANGE_REQUIRED',
    });
    const failures: string[] = [];
    for (const r of routes) {
      if (r.access.public || r.access.allow?.includes('PASSWORD_CHANGE_REQUIRED')) continue;
      const res = await send(b, r.method, concrete(r.url));
      if (res.json<{ error?: { code?: string } }>().error?.code !== 'AUTH_STEP_REQUIRED') {
        failures.push(`${label(r)} → ${res.statusCode}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
