import { randomBytes, randomUUID } from 'node:crypto';
import type { Role } from '@dental/shared';
import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { browser, buildTestApp } from '../../../test/app';
import { createUser, enableMfa, testClock, totpAt } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { createSecretBox } from '../../lib/secret-box';
import { createLogger } from '../../config/logger';
import { errorHandler } from '../error-handler';

/** Nom fictif reconnaissable : il ne doit jamais apparaître dans un journal. */
const SENTINEL = 'Zorglub-Sentinelle';

function capture(level = 'info') {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'api',
    env: 'test',
    level,
    destination: { write: (line: string) => void lines.push(line) },
  });
  return { logger, text: () => lines.join('') };
}

/**
 * Journaux applicatifs (docs/adr/0011) : une erreur imprévue garde de quoi diagnostiquer (type,
 * code PostgreSQL, contrainte, requête SQL sans ses valeurs, pile) mais aucune valeur saisie.
 */
describe('journaux applicatifs : erreurs sans données patient', () => {
  const t = openTestDatabase();
  afterAll(() => t.close());

  it('erreur SQL imprévue : ni les paramètres ni la valeur citée par PostgreSQL', async () => {
    const { logger, text } = capture();
    const app = Fastify({ loggerInstance: logger });
    app.setErrorHandler(errorHandler);
    // Valeur patient passée en paramètre à une requête qui échoue (22P02) : drizzle recopie les
    // paramètres dans son message, PostgreSQL cite la valeur dans le sien.
    app.get('/boom', async () => t.appDb.execute(sql`SELECT ${SENTINEL}::int AS n`));
    const res = await app.inject({ method: 'GET', url: '/boom' });
    await app.close();
    expect(res.statusCode).toBe(500);
    const logs = text();
    expect(logs).toContain('erreur non gérée');
    expect(logs).toContain('22P02');
    expect(logs).toContain('Failed query: SELECT $1::int AS n');
    expect(logs).not.toContain('Zorglub');
  });

  it('violation de contrainte : le détail (valeur de la clé) est écarté', async () => {
    const { logger, text } = capture();
    const client = await t.ownerPool.connect();
    try {
      await client.query('CREATE TEMP TABLE t_unique (email text UNIQUE)');
      await client.query('INSERT INTO t_unique VALUES ($1)', [`${SENTINEL}@cabinet.test`]);
      const error = await client
        .query('INSERT INTO t_unique VALUES ($1)', [`${SENTINEL}@cabinet.test`])
        .catch((e: unknown) => e);
      logger.error({ err: error }, 'erreur non gérée');
    } finally {
      client.release();
    }
    const logs = text();
    expect(logs).toContain('23505');
    expect(logs).toContain('t_unique_email_key');
    expect(logs).not.toContain('Zorglub');
  });

  it('corps JSON invalide : l’extrait cité par l’analyseur n’est pas journalisé', async () => {
    const { logger, text } = capture();
    const app = await buildTestApp(t.appPool, { logger });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: `${SENTINEL} n'est pas du JSON`,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    const logs = text();
    expect(logs).toContain('requête refusée');
    expect(logs).not.toContain('Zorglub');
  });
});

/**
 * Parcours réaliste au niveau debug (plus bavard que la production, en info) : aucune des
 * données saisies n'apparaît dans les journaux, y compris sur les chemins d'erreur.
 */
describe('journaux applicatifs : parcours complet sans donnée saisie', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  afterAll(() => t.close());

  it('patient, contacts, notes, rendez-vous, encaissement, recherche, import, erreurs', async () => {
    const { logger, text } = capture('debug');
    const clock = testClock(new Date('2026-09-28T08:00:00Z'));
    const secretBox = createSecretBox(randomBytes(32));
    const clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    const app = await buildTestApp(t.appPool, { now: clock.now, secretBox, logger });
    const signedIn = async (role: Role) => {
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
    };
    try {
      const admin = await signedIn('ADMIN');
      const dentist = await signedIn('DENTIST');
      const secretary = await signedIn('SECRETARY');
      const practitionerId = (
        await admin.post('/api/practitioners', { displayName: 'Dr Journal', color: '#0ea5e9' })
      ).json<{ id: string }>().id;
      const typeId = (
        await admin.post('/api/appointment-types', {
          name: 'Contrôle',
          durationMinutes: 30,
          color: '#0ea5e9',
        })
      ).json<{ id: string }>().id;

      const created = await secretary.post('/api/patients', {
        lastName: 'Zorglubnom',
        firstName: 'Zorglubprenom',
        birthDate: '1961-02-03',
        email: 'zorglub.mail@example.org',
        administrativeNote: 'Zorglubadmin',
        contacts: [{ phone: '+33 6 12 34 56 78', label: 'Zorglubetiquette' }],
      });
      expect(created.statusCode).toBe(201);
      const patientId = created.json<{ id: string }>().id;
      expect((await secretary.post('/api/patients/search', { q: 'Zorglubnom' })).statusCode).toBe(
        200,
      );
      expect(
        (
          await dentist.post(`/api/patients/${patientId}/medical-notes`, {
            content: 'Zorglubmedical allergie',
          })
        ).statusCode,
      ).toBe(204);
      expect((await dentist.get(`/api/patients/${patientId}/medical-notes`)).statusCode).toBe(200);
      const appointment = await secretary.post('/api/appointments', {
        practitionerId,
        patientId,
        appointmentTypeId: typeId,
        start: '2026-09-28T15:00',
        note: 'Zorglubrdv',
        allowOutsideAvailability: true,
      });
      expect(appointment.statusCode).toBe(201);
      const charge = await secretary.post('/api/charges', {
        idempotencyKey: randomUUID(),
        patientId,
        label: 'Zorglubacte',
        amountCents: 4200,
        payment: { amountCents: 4200, method: 'CARD', reference: 'Zorglubref' },
      });
      expect(charge.statusCode).toBe(201);

      // Chemins d'erreur avec des données saisies dans la requête.
      expect(
        (await secretary.post('/api/patients', { lastName: 'Zorglubinvalide', contacts: 'x' }))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await secretary.post('/api/charges', {
            idempotencyKey: randomUUID(),
            patientId: randomUUID(),
            label: 'Zorglubinconnu',
            amountCents: 100,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await secretary.post('/api/auth/login', {
            email: 'zorglub@x.org',
            password: 'Zorglubmdp',
          })
        ).statusCode,
      ).toBe(401);
      const batch = await admin.post('/api/imports', {
        kind: 'PATIENTS',
        fileName: 'Zorglubfichier.csv',
        totalRows: 1,
        dateFormat: 'DD/MM/YYYY',
      });
      expect(batch.statusCode).toBe(201);
      const rows = await admin.post(`/api/imports/${batch.json<{ id: string }>().id}/rows`, {
        rows: [{ line: 2, lastName: 'Zorglubimport', firstName: 'X', phones: ['0612'] }],
      });
      expect(rows.statusCode).toBeLessThan(300);
    } finally {
      await app.close();
    }
    const logs = text();
    expect(logs).toContain('"path":"/api/patients"');
    expect(logs).not.toMatch(/Zorglub|zorglub|1961-02-03|12 34 56 78|allergie/);
  });
});
