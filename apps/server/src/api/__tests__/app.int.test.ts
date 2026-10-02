import { apiErrorSchema, livenessResponseSchema, readinessResponseSchema } from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTestDatabase } from '../../../test/db';
import { createDb, createPool } from '../../db/client';
import { buildTestApp } from '../../../test/app';

describe('API : santé, erreurs et en-têtes', () => {
  const t = openTestDatabase();
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(t.appPool);
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  it('/health/live répond 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(livenessResponseSchema.parse(res.json())).toEqual({ status: 'ok' });
  });

  it('/health/ready répond 200 quand la base est joignable', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(readinessResponseSchema.parse(res.json()).checks.database).toBe('ok');
  });

  it('chaque réponse porte un identifiant de requête généré par le serveur', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'injection-client' },
    });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('les en-têtes de sécurité sont présents', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('une route inconnue renvoie 404 au format standard', async () => {
    const res = await app.inject({ method: 'GET', url: '/inexistant' });
    expect(res.statusCode).toBe(404);
    expect(apiErrorSchema.parse(res.json()).error.code).toBe('NOT_FOUND');
  });

  it('un corps JSON invalide renvoie 400 sans détail interne', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/health/live',
      headers: { 'content-type': 'application/json' },
      payload: '{invalide',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'BAD_REQUEST', message: 'Requête invalide' },
    });
  });

  it('une erreur inattendue renvoie 500 générique, sans message ni trace internes', async () => {
    const failing = createDb(t.appPool);
    const broken = await buildTestApp(t.appPool, {
      db: new Proxy(failing, {
        get: (target, prop) =>
          prop === 'transaction'
            ? () => Promise.reject(new Error('détail interne : mot de passe=abc'))
            : (Reflect.get(target, prop) as unknown),
      }),
    });
    const res = await broken.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x@cabinet.test', password: 'y' },
    });
    await broken.close();
    expect(res.statusCode).toBe(500);
    const body = apiErrorSchema.parse(res.json());
    expect(body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Erreur interne' });
    expect(res.body).not.toContain('mot de passe');
    expect(res.body).not.toContain('at ');
  });

  it('un corps trop volumineux est refusé', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/health/live',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'a'.repeat(1_100_000) }),
    });
    expect(res.statusCode).toBe(413);
  });
});

describe('API : base de données indisponible', () => {
  it('/health/ready répond 503 sans exposer la cause', async () => {
    const deadPool = createPool({
      connectionString: 'postgres://nobody:nothing@127.0.0.1:1/none',
      max: 1,
      applicationName: 'test-dead',
    });
    const app = await buildTestApp(deadPool);
    try {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: 'error', checks: { database: 'error' } });
    } finally {
      await app.close();
      await deadPool.end();
    }
  });
});
