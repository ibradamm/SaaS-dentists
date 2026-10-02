import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '../session-cookie';

/** Cookie de session tel qu'en staging et production (Secure), vérifié sur l'en-tête réel. */
describe('cookie de session hors développement', () => {
  it('__Host-, Secure, HttpOnly, SameSite=Lax, Path=/, sans Domain ; lu sous ce nom seulement', async () => {
    const app = Fastify();
    await app.register(cookie);
    const policy = { secure: true };
    app.get('/ouvrir', (_req, reply) => {
      setSessionCookie(reply, policy, 'jeton', new Date('2026-09-28T20:00:00Z'));
      return 'ok';
    });
    app.get('/fermer', (_req, reply) => {
      clearSessionCookie(reply, policy);
      return 'ok';
    });
    app.get('/lire', (req) => ({ token: readSessionCookie(req, policy) ?? null }));
    const opened = (await app.inject({ url: '/ouvrir' })).headers['set-cookie'] as string;
    expect(opened).toMatch(/^__Host-dental_session=jeton;/);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
      expect(opened).toContain(part);
    }
    expect(opened).not.toMatch(/Domain=/i);
    const cleared = (await app.inject({ url: '/fermer' })).headers['set-cookie'] as string;
    expect(cleared).toMatch(/^__Host-dental_session=;.*Secure/);
    // Un cookie sans préfixe (posé par un sous-domaine ou en HTTP) n'est pas accepté.
    const read = async (name: string) =>
      (await app.inject({ url: '/lire', headers: { cookie: `${name}=jeton` } })).json<{
        token: string | null;
      }>().token;
    expect(await read('dental_session')).toBeNull();
    expect(await read('__Host-dental_session')).toBe('jeton');
    await app.close();
  });
});
