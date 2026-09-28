import { randomBytes } from 'node:crypto';
import { meResponseSchema, type Role } from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_WEB_ORIGIN, browser, buildTestApp } from '../../../test/app';
import { createUser, enableMfa, testClock, totpAt, uniqueEmail } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { clinicMemberships, type Clinic } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { createSecretBox } from '../../lib/secret-box';

describe('API d’authentification', () => {
  const t = openTestDatabase();
  const clock = testClock(new Date());
  const secretBox = createSecretBox(randomBytes(32));
  let app: FastifyInstance;
  let clinic: Clinic;

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
    app = await buildTestApp(t.appPool, { now: clock.now, secretBox });
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  /** Connexion complète, code TOTP compris pour les rôles qui l'exigent. */
  async function signedIn(role: Role) {
    const user = await createUser(t.ownerDb, clinic.id, role);
    const secret =
      role === 'SECRETARY' ? null : await enableMfa(t.ownerDb, clinic.id, user.id, secretBox);
    const b = browser(app);
    const res = await b.login(user.email, user.password);
    expect(res.statusCode).toBe(200);
    if (secret) {
      clock.advanceSeconds(30);
      const verified = await b.post('/api/auth/mfa/verify', {
        code: await totpAt(secret, clock.epochSeconds()),
      });
      expect(verified.statusCode).toBe(200);
    }
    return { b, user };
  }

  it('parcours complet : connexion, profil, déconnexion', async () => {
    const { b, user } = await signedIn('SECRETARY');
    const me = meResponseSchema.parse((await b.get('/api/auth/me')).json());
    expect(me).toMatchObject({ role: 'SECRETARY', restriction: null, user: { email: user.email } });
    expect(me.permissions).toContain('appointment.write');
    expect(me.permissions).not.toContain('finance.reports.read');
    expect((await b.post('/api/auth/logout')).statusCode).toBe(204);
    expect((await b.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('compte de plusieurs cabinets : 409 avec la liste des cabinets, sans session', async () => {
    const other = await createTestClinic(t.ownerDb, { name: 'Cabinet Bis' });
    const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
    await withTenant(t.ownerDb, other.id, (tx) =>
      tx.insert(clinicMemberships).values({ userId: user.id, role: 'SECRETARY' }),
    );
    const res = await browser(app).login(user.email, user.password);
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: { code: string; clinics: { id: string; name: string }[] } }>();
    expect(body.error.code).toBe('CLINIC_SELECTION_REQUIRED');
    expect(body.error.clinics).toHaveLength(2);
    expect(body.error.clinics).toContainEqual({ id: other.id, name: 'Cabinet Bis' });
    expect(body.error.clinics).toContainEqual({ id: clinic.id, name: clinic.name });
    expect(res.cookies.find((c) => c.name === 'dental_session')).toBeUndefined();
    const chosen = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: user.password, clinicId: other.id },
    });
    expect(chosen.statusCode).toBe(200);
  });

  it('le cookie de session est httpOnly, SameSite=Lax, Path=/', async () => {
    const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: user.password },
    });
    const cookie = res.cookies.find((c) => c.name === 'dental_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Le jeton n'apparaît jamais dans le corps de la réponse.
    expect(res.body).not.toContain(cookie?.value);
  });

  it("l'e-mail est insensible à la casse et aux espaces", async () => {
    const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
    const res = await browser(app).login(`  ${user.email.toUpperCase()} `, user.password);
    expect(res.statusCode).toBe(200);
  });

  it('refuse une requête modifiante sans jeton CSRF ou avec un jeton faux', async () => {
    const { b } = await signedIn('SECRETARY');
    b.forgetCsrf();
    expect((await b.post('/api/auth/logout')).json()).toMatchObject({
      error: { code: 'CSRF_INVALID' },
    });
    const wrong = await b.post('/api/auth/logout', {}, { 'x-csrf-token': 'faux' });
    expect(wrong.statusCode).toBe(403);
    const csrf = (await b.get('/api/auth/csrf')).json<{ csrfToken: string }>().csrfToken;
    expect((await b.post('/api/auth/logout', {}, { 'x-csrf-token': csrf })).statusCode).toBe(204);
  });

  it("refuse une requête modifiante d'une autre origine, même la connexion", async () => {
    const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://site-malveillant.example' },
      payload: { email: user.email, password: user.password },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: TEST_WEB_ORIGIN },
      payload: { email: user.email, password: user.password },
    });
    expect(ok.statusCode).toBe(200);
  });

  it('sans session, les routes protégées répondent 401', async () => {
    for (const url of ['/api/auth/me', '/api/clinic', '/api/users']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    }
  });

  it('un mot de passe temporaire bloque tout sauf le changement de mot de passe', async () => {
    const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY', { mustChangePassword: true });
    const b = browser(app);
    expect((await b.login(user.email, user.password)).json()).toMatchObject({
      restriction: 'PASSWORD_CHANGE_REQUIRED',
    });
    expect((await b.get('/api/clinic')).json()).toMatchObject({
      error: { code: 'AUTH_STEP_REQUIRED' },
    });
    const changed = await b.post('/api/auth/password', {
      currentPassword: user.password,
      newPassword: 'un-nouveau-mot-de-passe',
    });
    expect(changed.json()).toMatchObject({ restriction: null });
    expect((await b.get('/api/clinic')).statusCode).toBe(200);
  });

  it('dentiste : mise en place obligatoire de la double authentification, puis code à chaque connexion', async () => {
    const user = await createUser(t.ownerDb, clinic.id, 'DENTIST');
    const b = browser(app);
    expect((await b.login(user.email, user.password)).json()).toMatchObject({
      restriction: 'MFA_ENROLLMENT_REQUIRED',
    });
    expect((await b.get('/api/clinic')).statusCode).toBe(403);
    const { secret } = (await b.post('/api/auth/mfa/setup')).json<{ secret: string }>();
    const activated = await b.post('/api/auth/mfa/activate', {
      code: await totpAt(secret, clock.epochSeconds()),
    });
    expect(activated.json()).toMatchObject({ restriction: null });
    expect((await b.get('/api/clinic')).statusCode).toBe(200);
    await b.post('/api/auth/logout');

    const again = browser(app);
    expect((await again.login(user.email, user.password)).json()).toMatchObject({
      restriction: 'MFA_PENDING',
    });
    const pendingToken = again.sessionToken;
    const me = meResponseSchema.parse((await again.get('/api/auth/me')).json());
    expect(me.permissions).toEqual([]);
    expect((await again.get('/api/clinic')).statusCode).toBe(403);
    clock.advanceSeconds(30);
    const verified = await again.post('/api/auth/mfa/verify', {
      code: await totpAt(secret, clock.epochSeconds()),
    });
    expect(verified.json()).toMatchObject({ restriction: null });
    // Nouveau jeton après la vérification (pas de fixation de session).
    expect(again.sessionToken).not.toBe(pendingToken);
    expect((await again.get('/api/clinic')).statusCode).toBe(200);
  });

  it('les champs invalides renvoient 400 sans détail interne', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'pas-un-email', password: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('limite le nombre de tentatives de connexion par adresse IP', async () => {
    const strict = await buildTestApp(t.appPool, {
      rateLimits: {
        global: { max: 1000, timeWindow: '1 minute' },
        sensitive: { max: 3, timeWindow: '1 minute' },
      },
    });
    try {
      const attempt = () =>
        strict.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: uniqueEmail(), password: 'x' },
        });
      for (let i = 0; i < 3; i++) expect((await attempt()).statusCode).toBe(401);
      const blocked = await attempt();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    } finally {
      await strict.close();
    }
  });

  describe('permissions au niveau HTTP (chaque rôle × chaque route protégée)', () => {
    const routes = [
      {
        label: 'GET /api/users',
        call: (b: Awaited<ReturnType<typeof signedIn>>['b']) => b.get('/api/users'),
        perm: 'user.manage',
      },
      {
        label: 'POST /api/users',
        call: (b: Awaited<ReturnType<typeof signedIn>>['b']) =>
          b.post('/api/users', { email: uniqueEmail('cree'), fullName: 'Créé', role: 'SECRETARY' }),
        perm: 'user.manage',
      },
      {
        label: 'PATCH /api/clinic',
        call: (b: Awaited<ReturnType<typeof signedIn>>['b']) =>
          b.patch('/api/clinic', { name: 'Cabinet renommé' }),
        perm: 'clinic.settings.manage',
      },
      {
        label: 'GET /api/clinic',
        call: (b: Awaited<ReturnType<typeof signedIn>>['b']) => b.get('/api/clinic'),
        perm: null,
      },
    ] as const;
    const allowed: Record<Role, readonly string[]> = {
      ADMIN: ['user.manage', 'clinic.settings.manage'],
      DENTIST: [],
      SECRETARY: [],
    };

    it.each(['ADMIN', 'DENTIST', 'SECRETARY'] as const)('%s', async (role) => {
      const { b } = await signedIn(role);
      for (const route of routes) {
        const res = await route.call(b);
        const expectedOk = route.perm === null || allowed[role].includes(route.perm);
        expect({ route: route.label, ok: res.statusCode < 300 }).toEqual({
          route: route.label,
          ok: expectedOk,
        });
        if (!expectedOk) expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
      }
    });

    it('les réponses de gestion des utilisateurs ne contiennent aucun secret', async () => {
      const { b } = await signedIn('ADMIN');
      const body = (await b.get('/api/users')).body;
      expect(body).not.toMatch(/password|argon2|mfa_secret|mfaSecret/i);
    });
  });
});
