import { randomBytes } from 'node:crypto';
import {
  importSummarySchema,
  listPatientsResponseSchema,
  patientDetailSchema,
  type Role,
} from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, buildTestApp } from '../../../test/app';
import { createUser, enableMfa, testClock, totpAt } from '../../../test/auth';
import { createLogger } from '../../config/logger';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import type { Clinic } from '../../db/schema';
import { createSecretBox } from '../../lib/secret-box';

type Browser = ReturnType<typeof browser>;

describe('API patients et import', () => {
  const t = openTestDatabase();
  const clock = testClock(new Date());
  const secretBox = createSecretBox(randomBytes(32));
  let app: FastifyInstance;
  let clinic: Clinic;

  // Journal réel de l'API (même configuration qu'en production), capturé pour vérifier son contenu.
  const logLines: string[] = [];
  const logger = createLogger({
    service: 'api',
    env: 'test',
    level: 'info',
    destination: { write: (line: string) => void logLines.push(line) },
  });

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
    app = await buildTestApp(t.appPool, { now: clock.now, secretBox, logger });
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

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

  async function createPatient(b: Browser, lastName = 'Moreau') {
    const res = await b.post('/api/patients', {
      lastName,
      firstName: 'Inès',
      birthDate: '1988-04-01',
      contacts: [{ phone: '06 55 44 33 22' }],
    });
    expect(res.statusCode).toBe(201);
    return patientDetailSchema.parse(res.json());
  }

  describe('permissions HTTP par rôle', () => {
    const expectations: Record<Role, { medical: boolean; imports: boolean }> = {
      ADMIN: { medical: true, imports: true },
      DENTIST: { medical: true, imports: false },
      SECRETARY: { medical: false, imports: false },
    };

    it.each(['ADMIN', 'DENTIST', 'SECRETARY'] as const)('%s', async (role) => {
      const b = await signedIn(role);
      const patient = await createPatient(b, `Perm${role}`);
      expect((await b.get('/api/patients?q=perm')).statusCode).toBe(200);
      expect((await b.get(`/api/patients/${patient.id}`)).statusCode).toBe(200);
      expect(
        (
          await b.patch(`/api/patients/${patient.id}`, {
            version: patient.version,
            email: 'x@exemple.fr',
          })
        ).statusCode,
      ).toBe(200);

      const noteWrite = await b.post(`/api/patients/${patient.id}/medical-notes`, {
        content: 'Note clinique',
      });
      const noteRead = await b.get(`/api/patients/${patient.id}/medical-notes`);
      const importList = await b.get('/api/imports');
      const importCreate = await b.post('/api/imports', {
        kind: 'PATIENTS',
        fileName: 'f.csv',
        totalRows: 1,
        dateFormat: 'DD/MM/YYYY',
      });
      const exp = expectations[role];
      expect({ noteWrite: noteWrite.statusCode, noteRead: noteRead.statusCode }).toEqual(
        exp.medical ? { noteWrite: 204, noteRead: 200 } : { noteWrite: 403, noteRead: 403 },
      );
      expect({ list: importList.statusCode, create: importCreate.statusCode }).toEqual(
        exp.imports ? { list: 200, create: 201 } : { list: 403, create: 403 },
      );
    });
  });

  it('recherche, doublons, contacts, archivage via HTTP', async () => {
    const b = await signedIn('SECRETARY');
    const p = await createPatient(b, 'Rechercheapi');
    const found = listPatientsResponseSchema.parse(
      (await b.get('/api/patients?q=RECHERCHEAPI')).json(),
    );
    expect(found.patients.map((x) => x.id)).toContain(p.id);
    const dup = (
      await b.get(
        '/api/patients/duplicates?lastName=Rechercheapi&firstName=ines&birthDate=1988-04-01',
      )
    ).json<{ candidates: { id: string }[] }>();
    expect(dup.candidates.map((c) => c.id)).toContain(p.id);

    const withContact = patientDetailSchema.parse(
      (
        await b.post(`/api/patients/${p.id}/contacts`, {
          phone: '01 23 45 67 89',
          relationship: 'GUARDIAN',
          label: 'Mère',
        })
      ).json(),
    );
    const added = withContact.contacts.find((c) => c.phone === '+33123456789')!;
    b.forgetCsrf();
    expect((await b.delete(`/api/patients/${p.id}/contacts/${added.id}`)).statusCode).toBe(403);
    await b.get('/api/auth/csrf');
    const csrf = (await b.get('/api/auth/csrf')).json<{ csrfToken: string }>().csrfToken;
    const afterDelete = await b.delete(`/api/patients/${p.id}/contacts/${added.id}`, {
      'x-csrf-token': csrf,
    });
    expect(afterDelete.statusCode).toBe(200);

    const current = patientDetailSchema.parse(afterDelete.json());
    const archived = await b.post(
      `/api/patients/${p.id}/archive`,
      { version: current.version },
      { 'x-csrf-token': csrf },
    );
    expect(patientDetailSchema.parse(archived.json()).status).toBe('ARCHIVED');
  });

  it('erreurs : validation 400, version périmée 409, identifiant inconnu 404 ou mal formé 400', async () => {
    const b = await signedIn('SECRETARY');
    const p = await createPatient(b, 'Erreurs');
    expect((await b.post('/api/patients', { lastName: '', firstName: 'X' })).statusCode).toBe(400);
    expect(
      (
        await b.post('/api/patients', {
          lastName: 'X',
          firstName: 'Y',
          contacts: [{ phone: '12' }],
        })
      ).statusCode,
    ).toBe(400);
    await b.patch(`/api/patients/${p.id}`, { version: p.version, firstName: 'Ines' });
    const stale = await b.patch(`/api/patients/${p.id}`, {
      version: p.version,
      firstName: 'Autre',
    });
    expect(stale.statusCode).toBe(409);
    expect((await b.get('/api/patients/01a0de00-0000-7000-8000-00000000dead')).statusCode).toBe(
      404,
    );
    expect((await b.get('/api/patients/pas-un-uuid')).statusCode).toBe(400);
  });

  it('import complet par HTTP, y compris un paquet de 500 lignes au-delà de 1 Mo', async () => {
    const b = await signedIn('ADMIN');
    const created = importSummarySchema.parse(
      (
        await b.post('/api/imports', {
          kind: 'PATIENTS',
          fileName: 'gros-export.xlsx',
          totalRows: 500,
          dateFormat: 'DD/MM/YYYY',
        })
      ).json(),
    );
    const rows = Array.from({ length: 500 }, (_, i) => ({
      line: i + 2,
      lastName: `Http${i}`,
      firstName: 'Import',
      birthDate: '15/06/1980',
      phones: ['0612345678'],
      administrativeNote: 'n'.repeat(2500),
    }));
    const payloadSize = Buffer.byteLength(JSON.stringify({ rows }));
    expect(payloadSize).toBeGreaterThan(1024 * 1024);
    const added = await b.post(`/api/imports/${created.id}/rows`, { rows });
    expect(added.statusCode).toBe(200);
    expect(importSummarySchema.parse(added.json()).counts.valid).toBe(500);
    // Une note de plus de 1000 caractères est ignorée avec un avertissement.
    const report = (await b.get(`/api/imports/${created.id}/rows?limit=5`)).json<{
      total: number;
    }>();
    expect(report.total).toBe(500);
    const committed = importSummarySchema.parse(
      (await b.post(`/api/imports/${created.id}/commit`)).json(),
    );
    expect(committed).toMatchObject({ status: 'COMMITTED', counts: { created: 500 } });
    const reverted = await b.post(`/api/imports/${created.id}/revert`);
    expect(reverted.json()).toMatchObject({ deleted: 500, kept: 0 });
  });

  it('refuse un paquet de plus de 500 lignes', async () => {
    const b = await signedIn('ADMIN');
    const created = importSummarySchema.parse(
      (
        await b.post('/api/imports', {
          kind: 'PATIENTS',
          fileName: 'f.csv',
          totalRows: 600,
          dateFormat: 'DD/MM/YYYY',
        })
      ).json(),
    );
    const rows = Array.from({ length: 501 }, (_, i) => ({
      line: i + 2,
      lastName: 'A',
      firstName: 'B',
    }));
    expect((await b.post(`/api/imports/${created.id}/rows`, { rows })).statusCode).toBe(400);
  });
  it('les journaux ne contiennent ni la chaîne de requête ni les données recherchées', async () => {
    const s = await signedIn('SECRETARY');
    expect((await s.get('/api/patients?q=Zorglub-Confidentiel')).statusCode).toBe(200);
    const duplicates = await s.get(
      '/api/patients/duplicates?lastName=Zorglub&firstName=Secret&birthDate=1970-01-01',
    );
    expect(duplicates.statusCode).toBe(200);
    const logs = logLines.join('');
    expect(logs).toContain('"path":"/api/patients"');
    expect(logs).toContain('"path":"/api/patients/duplicates"');
    expect(logs).not.toMatch(/Zorglub|1970-01-01|"url"/);
  });
});
