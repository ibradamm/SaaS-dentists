import { randomBytes, randomUUID } from 'node:crypto';
import type { Role } from '@dental/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, buildTestApp } from '../../../test/app';
import { createUser, enableMfa, testClock, totpAt } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import type { Clinic } from '../../db/schema';
import { createSecretBox } from '../../lib/secret-box';
import { routeInventory } from '../auth-plugin';

type Browser = ReturnType<typeof browser>;

/**
 * Fuite entre cabinets (docs/adr/0011) : l'administrateur du cabinet A (toutes les permissions)
 * appelle chaque route de l'API avec les identifiants des données du cabinet B. Aucune réponse
 * ne contient une donnée de B et aucune donnée de B n'est modifiée (empreinte de toutes les
 * tables avant et après).
 */
describe('isolation entre cabinets : toutes les routes, identifiants d’un autre cabinet', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  const clock = testClock(new Date('2026-09-28T08:00:00Z'));
  const secretBox = createSecretBox(randomBytes(32));
  let app: FastifyInstance;
  let clinicA: Clinic;
  let clinicB: Clinic;
  /** Identifiants des données de B, par nom de ressource. */
  const b: Record<string, string> = {};
  /** Textes saisis dans B : aucun ne doit apparaître dans une réponse faite à A. */
  const secrets = [
    'Bfuitenom',
    'Bfuiteprenom',
    'Bfuitecontact',
    '0611223344',
    'Bfuitemedical',
    'Bfuiterdv',
    'Bfuiteacte',
    'Bfuitepraticien',
    'Bfuitetype',
    'Bfuiteblocage',
    'Bfuitefichier',
    'Bfuiteimport',
  ];

  async function signedIn(clinic: Clinic, role: Role): Promise<Browser> {
    const user = await createUser(t.ownerDb, clinic.id, role);
    const secret =
      role === 'SECRETARY' ? null : await enableMfa(t.ownerDb, clinic.id, user.id, secretBox);
    const s = browser(app);
    await s.login(user.email, user.password);
    if (secret) {
      clock.advanceSeconds(30);
      await s.post('/api/auth/mfa/verify', { code: await totpAt(secret, clock.epochSeconds()) });
    }
    return s;
  }
  const idOf = async (p: Promise<{ statusCode: number; json: <T>() => T }>) => {
    const res = await p;
    expect(res.statusCode).toBeLessThan(300);
    return res.json<{ id: string }>().id;
  };

  /**
   * Empreinte de toutes les lignes de B, table par table. Le rôle propriétaire est lui aussi
   * soumis à la RLS forcée : la lecture se fait dans le contexte de B, sinon elle ne verrait
   * aucune ligne et l'empreinte ne prouverait rien.
   */
  async function fingerprintOfB(): Promise<Record<string, string>> {
    const client = await t.ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.clinic_id', $1, true)", [clinicB.id]);
      const { rows: tables } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'clinic_id' ORDER BY table_name`,
      );
      const out: Record<string, string> = {};
      for (const { table_name: table } of tables) {
        const { rows } = await client.query<{ n: number; h: string | null }>(
          `SELECT count(*)::int AS n, md5(string_agg(x::text, '|' ORDER BY x::text)) AS h
             FROM "${table}" x WHERE clinic_id = $1`,
          [clinicB.id],
        );
        out[table] = `${rows[0]!.n}:${rows[0]!.h}`;
      }
      const clinic = await client.query<{ h: string }>(
        'SELECT md5(c::text) AS h FROM clinics c WHERE id = $1',
        [clinicB.id],
      );
      const members = await client.query<{ h: string }>(
        `SELECT md5(string_agg(u::text, '|' ORDER BY u.id)) AS h FROM users u
          WHERE id IN (SELECT user_id FROM clinic_memberships WHERE clinic_id = $1)`,
        [clinicB.id],
      );
      await client.query('COMMIT');
      out.clinics = String(clinic.rows[0]?.h);
      out.users = String(members.rows[0]?.h);
      return out;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    clinicA = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    clinicB = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris' });
    app = await buildTestApp(t.appPool, { now: clock.now, secretBox });

    // Cabinet B complet, créé par ses propres comptes.
    const adminB = await signedIn(clinicB, 'ADMIN');
    const secretaryB = await signedIn(clinicB, 'SECRETARY');
    b.practitioner = await idOf(
      adminB.post('/api/practitioners', { displayName: 'Bfuitepraticien', color: '#0ea5e9' }),
    );
    b.type = await idOf(
      adminB.post('/api/appointment-types', {
        name: 'Bfuitetype',
        durationMinutes: 30,
        color: '#0ea5e9',
      }),
    );
    const schedule = await adminB.put(`/api/practitioners/${b.practitioner}/schedules`, {
      validFrom: '2026-09-28',
      basePeriod: null,
      intervals: [{ weekday: 1, start: '09:00', end: '12:00' }],
    });
    expect(schedule.statusCode).toBeLessThan(300);
    b.period = (await adminB.get(`/api/practitioners/${b.practitioner}/schedules`)).json<{
      periods: { id: string }[];
    }>().periods[0]!.id;
    const block = await adminB.post('/api/availability-blocks', {
      practitionerId: b.practitioner,
      kind: 'BLOCK',
      label: 'Bfuiteblocage',
      allDay: true,
      startDate: '2026-10-02',
      endDate: '2026-10-02',
    });
    expect(block.statusCode).toBe(201);
    b.block = block.json<{ block: { id: string } }>().block.id;
    const patient = await secretaryB.post('/api/patients', {
      lastName: 'Bfuitenom',
      firstName: 'Bfuiteprenom',
      contacts: [{ phone: '0611223344', label: 'Bfuitecontact' }],
    });
    b.patient = patient.json<{ id: string }>().id;
    b.contact = patient.json<{ contacts: { id: string }[] }>().contacts[0]!.id;
    expect(
      (await adminB.post(`/api/patients/${b.patient}/medical-notes`, { content: 'Bfuitemedical' }))
        .statusCode,
    ).toBe(204);
    b.appointment = await idOf(
      secretaryB.post('/api/appointments', {
        practitionerId: b.practitioner,
        patientId: b.patient,
        appointmentTypeId: b.type,
        start: '2026-09-28T11:00',
        note: 'Bfuiterdv',
        allowOutsideAvailability: true,
      }),
    );
    const charge = await secretaryB.post('/api/charges', {
      idempotencyKey: randomUUID(),
      patientId: b.patient,
      label: 'Bfuiteacte',
      amountCents: 5000,
      payment: { amountCents: 2000, method: 'CASH' },
    });
    expect(charge.statusCode).toBe(201);
    b.charge = charge.json<{ id: string }>().id;
    b.payment = charge.json<{ payments: { id: string }[] }>().payments[0]!.id;
    b.import = await idOf(
      adminB.post('/api/imports', {
        kind: 'PATIENTS',
        fileName: 'Bfuitefichier.csv',
        totalRows: 1,
        dateFormat: 'DD/MM/YYYY',
      }),
    );
    expect(
      (
        await adminB.post(`/api/imports/${b.import}/rows`, {
          rows: [{ line: 2, lastName: 'Bfuiteimport', firstName: 'X', phones: [] }],
        })
      ).statusCode,
    ).toBeLessThan(300);
    b.user = (await adminB.get('/api/users')).json<{ users: { id: string }[] }>().users[0]!.id;
    // Chaque ressource de B existe vraiment : un identifiant manquant rendrait le test aveugle.
    expect(Object.values(b).every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    expect(Object.keys(b)).toHaveLength(11);
    secrets.push(...Object.values(b));
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });

  const RESOURCE_BY_PREFIX: [RegExp, string][] = [
    [/^\/api\/patients\/:id/, 'patient'],
    [/^\/api\/appointments\/:id/, 'appointment'],
    [/^\/api\/charges\/:id/, 'charge'],
    [/^\/api\/payments\/:id/, 'payment'],
    [/^\/api\/practitioners\/:id/, 'practitioner'],
    [/^\/api\/appointment-types\/:id/, 'type'],
    [/^\/api\/availability-blocks\/:id/, 'block'],
    [/^\/api\/imports\/:id/, 'import'],
    [/^\/api\/users\/:id/, 'user'],
  ];
  /** Routes à identifiant sans ressource de B associée : le test serait aveugle pour elles. */
  const unmapped: string[] = [];
  function urlWithIdsOfB(url: string): string {
    const resource = RESOURCE_BY_PREFIX.find(([re]) => re.test(url))?.[1];
    if (url.includes(':id') && !resource) unmapped.push(url);
    return url
      .replace(':contactId', b.contact!)
      .replace(':periodId', b.period!)
      .replace(':id', resource ? b[resource]! : randomUUID());
  }

  it('aucune réponse ne contient de donnée de B ; aucune donnée de B ne change', async () => {
    const adminA = await signedIn(clinicA, 'ADMIN');
    // La vérification du journal de B (plus bas) crée une session dans B : elle se fait avant
    // la première empreinte.
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const auditQuery = new URLSearchParams({ from: day(-2), to: day(2) }).toString();
    const auditOfB = await (await signedIn(clinicB, 'ADMIN')).get(`/api/audit-logs?${auditQuery}`);
    expect(auditOfB.json<{ entries: unknown[] }>().entries.length).toBeGreaterThan(5);

    const before = await fingerprintOfB();
    // L'empreinte voit bien les données de B (sinon elle serait constante et le test aveugle).
    for (const table of ['patients', 'appointments', 'charges', 'payments', 'audit_logs']) {
      expect(before[table], table).toMatch(/^[1-9]\d*:[0-9a-f]{32}$/);
    }
    expect(before.users).toMatch(/^[0-9a-f]{32}$/);
    // Corps plausible pour toutes les routes (les champs inconnus d'une route sont ignorés),
    // qui désigne les données de B partout où un identifiant est attendu.
    const body = {
      version: 1,
      lastName: 'Intrus',
      firstName: 'Intrus',
      phone: '0600000000',
      relationship: 'SELF',
      content: 'Intrus',
      note: 'Intrus',
      reason: 'Intrusion',
      billingExempt: true,
      displayName: 'Intrus',
      name: 'Intrus',
      color: '#0ea5e9',
      durationMinutes: 30,
      label: 'Intrus',
      kind: 'BLOCK',
      allDay: true,
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      validFrom: '2026-10-05',
      basePeriod: null,
      intervals: [],
      rows: [{ line: 2, lastName: 'Intrus', firstName: 'Intrus', phones: [] }],
      idempotencyKey: randomUUID(),
      amountCents: 100,
      method: 'CASH',
      practitionerId: b.practitioner,
      patientId: b.patient,
      appointmentTypeId: b.type,
      appointmentId: b.appointment,
      chargeId: b.charge,
      userId: b.user,
      start: '2026-10-05T10:00',
      allowOutsideAvailability: true,
    };
    const overrides: Record<string, object> = {
      'PATCH /api/users/:id': { role: 'SECRETARY' },
      'POST /api/appointments/:id/status': { version: 1, status: 'CANCELLED', reason: null },
      'PATCH /api/patients/:id/contacts/:contactId': { label: 'Intrus' },
    };
    const query = new URLSearchParams({
      from: '2026-09-28',
      to: '2026-10-04',
      practitionerId: b.practitioner!,
      patientId: b.patient!,
      appointmentTypeId: b.type!,
      q: 'Bfuitenom',
      lastName: 'Bfuitenom',
      firstName: 'Bfuiteprenom',
      durationMinutes: '30',
      actorId: b.user!,
      entityId: b.patient!,
    }).toString();

    const leaks: string[] = [];
    const accepted: string[] = [];
    const statuses: Record<string, number> = {};
    const routes = routeInventory(app).filter(
      (r) => r.method !== 'HEAD' && !r.url.startsWith('/api/auth/') && !r.access.public,
    );
    for (const r of routes) {
      const key = `${r.method} ${r.url}`;
      const url = urlWithIdsOfB(r.url);
      const payload = overrides[key] ?? body;
      const res =
        r.method === 'GET'
          ? await adminA.get(`${url}?${r.url.startsWith('/api/audit-logs') ? auditQuery : query}`)
          : r.method === 'DELETE'
            ? await adminA.delete(`${url}?version=1`)
            : r.method === 'PATCH'
              ? await adminA.patch(url, payload)
              : r.method === 'PUT'
                ? await adminA.put(url, payload)
                : await adminA.post(url, payload);
      statuses[key] = res.statusCode;
      const found = secrets.filter((s) => res.body.includes(s));
      if (found.length > 0) leaks.push(`${key} → ${found.join(', ')}`);
      // Une route qui désigne une donnée de B (paramètre ou corps) ne réussit jamais.
      const targetsB =
        r.url.includes(':') ||
        [
          'POST /api/appointments',
          'POST /api/charges',
          'POST /api/payments',
          'POST /api/availability-blocks',
          'POST /api/practitioners',
        ].includes(key);
      if (targetsB && res.statusCode < 300) accepted.push(`${key} → ${res.statusCode}`);
    }
    expect(unmapped).toEqual([]);
    expect(leaks).toEqual([]);
    expect(accepted).toEqual([]);
    expect(await fingerprintOfB()).toEqual(before);
    // Les routes qui désignent une donnée de B répondent « introuvable » (preuve que la requête
    // a passé la validation et atteint la recherche), sauf exceptions justifiées ci-dessous.
    const notFound = Object.entries(statuses)
      .filter(([k]) => k.includes(':'))
      .filter(([, status]) => status !== 404);
    expect(notFound).toEqual([]);
  });
});
