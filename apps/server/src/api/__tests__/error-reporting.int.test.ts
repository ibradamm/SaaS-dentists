import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/app';
import { openTestDatabase } from '../../../test/db';
import { createDb } from '../../db/client';
import { registerJobHandlers } from '../../jobs/handlers';
import { RETENTION_QUEUE } from '../../jobs/retention';
import { createSentryReporter, type ErrorReporter } from '../../lib/error-reporter';
import { createErrorHandler } from '../error-handler';

interface Received {
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * Remontée des erreurs de bout en bout (docs/adr/0011), contre un serveur d'ingestion local
 * qui reçoit exactement ce que recevrait Sentry. Le vrai service n'est pas joignable depuis
 * l'environnement de test : l'envoi réel reste à vérifier en recette.
 */
describe('remontée des erreurs : ce qui part vers Sentry', () => {
  const t = openTestDatabase();
  const received: Received[] = [];
  let server: Server;
  let reporter: ErrorReporter;
  const silent = pino({ level: 'silent' });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({ url: req.url ?? '', headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    reporter = createSentryReporter({
      dsn: `http://clepublique@127.0.0.1:${port}/42`,
      environment: 'staging',
      release: 'test-1',
      service: 'api',
      logger: silent,
    });
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await t.close();
  });

  const envelopes = () =>
    received.map((r) => {
      const [header, item, event] = r.body.split('\n').map((line) => JSON.parse(line) as unknown);
      return { ...r, header, item, event: event as Record<string, unknown> };
    });

  it('erreur SQL imprévue avec une donnée patient : événement conforme, sans la donnée', async () => {
    received.length = 0;
    const app = Fastify({ loggerInstance: silent });
    app.setErrorHandler(createErrorHandler(reporter));
    app.get('/boom', async () => t.appDb.execute(sql`SELECT ${'Zorglub Léa'}::int AS n`));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    await reporter.flush();
    expect(res.statusCode).toBe(500);
    const [sent] = envelopes();
    expect(received).toHaveLength(1);
    expect(sent!.url).toBe('/api/42/envelope/');
    expect(sent!.headers['content-type']).toBe('application/x-sentry-envelope');
    expect(sent!.headers['x-sentry-auth']).toMatch(
      /^Sentry sentry_version=7, .*sentry_key=clepublique$/,
    );
    expect(sent!.item).toEqual({ type: 'event', content_type: 'application/json' });
    expect(sent!.event).toMatchObject({
      environment: 'staging',
      release: 'test-1',
      tags: {
        service: 'api',
        error_code: '22P02',
        request_id: res.json<{ error: { requestId: string } }>().error.requestId,
      },
    });
    expect(sent!.body).not.toMatch(/Zorglub|Léa/);
    // Ni requête HTTP, ni utilisateur, ni fil d'Ariane, ni variables.
    for (const key of ['request', 'user', 'breadcrumbs', 'extra', 'server_name']) {
      expect(sent!.event).not.toHaveProperty(key);
    }
  });

  it('application complète : une erreur 500 est remontée, jamais un refus attendu (4xx)', async () => {
    received.length = 0;
    const failing = createDb(t.appPool);
    const app = await buildTestApp(t.appPool, {
      errorReporter: reporter,
      db: new Proxy(failing, {
        get: (target, prop) =>
          prop === 'transaction'
            ? () => Promise.reject(new Error('panne simulée'))
            : (Reflect.get(target, prop) as unknown),
      }),
    });
    const json = { 'content-type': 'application/json' };
    const ok4xx = [
      await app.inject({ method: 'GET', url: '/api/patients' }), // 401 (erreur métier)
      await app.inject({ method: 'GET', url: '/inexistant' }), // 404
      // Refus de Fastify lui-même (branche 4xx du gestionnaire d'erreurs).
      await app.inject({ method: 'POST', url: '/api/auth/login', headers: json, payload: '{x' }),
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: json,
        payload: JSON.stringify({ x: 'a'.repeat(1_100_000) }),
      }),
    ];
    const failed = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x@cabinet.test', password: 'mot-de-passe' },
    });
    await app.close();
    await reporter.flush();
    expect(ok4xx.map((r) => r.statusCode)).toEqual([401, 404, 400, 413]);
    expect(failed.statusCode).toBe(500);
    expect(received).toHaveLength(1);
    expect(envelopes()[0]!.body).not.toContain('mot-de-passe');
  });

  it('worker : l’échec d’une tâche est remonté avec le nom de la tâche', async () => {
    received.length = 0;
    const handlers = new Map<string, () => Promise<void>>();
    const fakeBoss = {
      work: (name: string, handler: () => Promise<void>) => {
        handlers.set(name, handler);
        return Promise.resolve('id');
      },
      schedule: () => Promise.resolve(),
    };
    const brokenDb = new Proxy(createDb(t.appPool), {
      get: (target, prop) =>
        prop === 'execute'
          ? () => Promise.reject(new Error('base indisponible'))
          : (Reflect.get(target, prop) as unknown),
    });
    await registerJobHandlers(fakeBoss as never, {
      logger: silent,
      pool: t.appPool,
      db: brokenDb,
      errorReporter: reporter,
    });
    await expect(handlers.get(RETENTION_QUEUE)!()).rejects.toThrow('base indisponible');
    await reporter.flush();
    expect(envelopes()[0]!.event).toMatchObject({ tags: { job: RETENTION_QUEUE } });
  });

  it('Sentry indisponible ou lent : la requête n’échoue pas, la remontée est abandonnée', async () => {
    const unreachable = createSentryReporter({
      dsn: 'http://cle@127.0.0.1:1/42',
      environment: 'staging',
      service: 'api',
      logger: silent,
    });
    const app = Fastify({ loggerInstance: silent });
    app.setErrorHandler(createErrorHandler(unreachable));
    app.get('/boom', () => {
      throw new Error('imprévu');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    await unreachable.flush();
    expect(res.statusCode).toBe(500);
  });
});
