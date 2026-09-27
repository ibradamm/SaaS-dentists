import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser, testClock } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import type { Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import type { UserActor } from '../../auth/auth.types';
import { createFinanceService } from '../../finance/finance.service';
import { createPractitionersService } from '../../scheduling/practitioners.service';
import { createStatsService } from '../stats.service';

/*
 * Volume : une année d'activité d'un cabinet de quatre praticiens (16 créneaux par jour ouvré,
 * 5 000 patients, actes et paiements des rendez-vous honorés), plus un second cabinet chargé
 * de la même façon. Mesure le temps et le nombre de requêtes d'un tableau de bord, qui ne doit
 * dépendre ni du volume ni de la longueur de la période (docs/adr/0010, section 6).
 */
describe('tableau de bord : performance avec une année de données', () => {
  const t = openTestDatabase({ appPoolMax: 4 });
  const clock = testClock(new Date('2026-09-28T08:00:00Z'));
  const deps = { db: t.appDb, now: clock.now };
  const stats = createStatsService(deps);
  const finance = createFinanceService(deps);
  const practitionersService = createPractitionersService(deps);
  let clinic: Clinic;
  let dentist: UserActor;
  const volumes: Record<string, number> = {};

  async function seed(c: Clinic): Promise<UserActor> {
    const admin = actorFor((await createUser(t.ownerDb, c.id, 'ADMIN')).id, 'ADMIN', c.id);
    const prs: string[] = [];
    for (const name of ['Dr Un', 'Dr Deux', 'Dr Trois', 'Dr Quatre']) {
      prs.push(
        (
          await practitionersService.createPractitioner(
            admin,
            { displayName: name, color: '#0ea5e9' },
            META,
          )
        ).id,
      );
    }
    const types: string[] = [];
    for (const name of ['Consultation', 'Détartrage', 'Radio', 'Soin', 'Urgence']) {
      types.push(
        (
          await practitionersService.createType(
            admin,
            { name, durationMinutes: 30, color: '#10b981' },
            META,
          )
        ).id,
      );
    }
    const array = (ids: readonly string[]) => `{${ids.join(',')}}`;
    await withTenant(t.appDb, c.id, async (tx) => {
      // Horaires : du lundi au vendredi, 8 h - 12 h et 14 h - 18 h (heure de Paris, UTC+1/+2).
      await tx.execute(sql`
        WITH s AS (
          INSERT INTO working_schedules (id, clinic_id, practitioner_id, valid_from)
          SELECT gen_random_uuid(), ${c.id}, p, '2025-01-01'
          FROM unnest(${array(prs)}::uuid[]) AS p
          RETURNING id
        )
        INSERT INTO working_intervals (id, clinic_id, schedule_id, weekday, start_minute, end_minute)
        SELECT gen_random_uuid(), ${c.id}, s.id, d, m.s, m.e
        FROM s, generate_series(1, 5) d, (VALUES (480, 720), (840, 1080)) AS m(s, e)`);
      await tx.execute(sql`
        INSERT INTO patients (id, clinic_id, last_name, first_name, search_text, created_source, created_at)
        SELECT gen_random_uuid(), ${c.id}, 'Perf' || i, 'Patient', 'perf' || i || ' patient', 'STAFF',
               timestamptz '2025-01-01 08:00Z' + (i % 630) * interval '1 day'
        FROM generate_series(1, 5000) i`);
      // 16 créneaux de 30 min par praticien et par jour ouvré ; un patient différent par
      // praticien à un même instant. Statuts : passés honorés (sauf absences et annulations
      // régulières), futurs prévus.
      await tx.execute(sql`
        WITH pts AS (SELECT array_agg(id ORDER BY id) AS ids FROM patients WHERE clinic_id = ${c.id}),
        slots AS (
          SELECT d::date AS day, k, row_number() OVER (ORDER BY d, k) AS n
          FROM generate_series(date '2026-01-01', date '2026-12-31', interval '1 day') d,
               generate_series(0, 15) k
          WHERE extract(isodow FROM d) < 6
        ),
        rows AS (
          SELECT slots.*, p, (${array(prs)}::uuid[])[p] AS practitioner_id,
                 (slots.day + time '07:00' + (k + CASE WHEN k >= 8 THEN 4 ELSE 0 END) * interval '30 minutes')
                   AT TIME ZONE 'UTC' AS start_at
          FROM slots, generate_series(1, 4) p
        )
        INSERT INTO appointments (id, clinic_id, practitioner_id, patient_id, appointment_type_id, start_at, end_at, status)
        SELECT gen_random_uuid(), ${c.id}, practitioner_id, pts.ids[((n * 4 + p) % 5000) + 1],
               (${array(types)}::uuid[])[(n % 5) + 1], start_at, start_at + interval '30 minutes',
               CASE WHEN start_at >= timestamptz '2026-09-28 08:00Z' THEN 'SCHEDULED'
                    WHEN (n + p) % 13 = 0 THEN 'NO_SHOW'
                    WHEN (n + p) % 11 = 0 THEN 'CANCELLED'
                    ELSE 'COMPLETED' END
        FROM rows, pts`);
      await tx.execute(sql`
        INSERT INTO charges (id, clinic_id, patient_id, appointment_id, practitioner_id, label, amount_cents, currency, idempotency_key)
        SELECT gen_random_uuid(), clinic_id, patient_id, id, practitioner_id, 'Acte',
               5000 + (extract(epoch FROM start_at)::bigint / 1800 % 100) * 100, 'EUR', gen_random_uuid()
        FROM appointments WHERE clinic_id = ${c.id} AND status = 'COMPLETED'`);
      await tx.execute(sql`
        INSERT INTO payments (id, clinic_id, patient_id, charge_id, amount_cents, currency, method, received_at, idempotency_key)
        SELECT gen_random_uuid(), ch.clinic_id, ch.patient_id, ch.id,
               CASE WHEN extract(epoch FROM a.start_at)::bigint / 1800 % 10 = 0 THEN ch.amount_cents / 2 ELSE ch.amount_cents END,
               'EUR', (ARRAY['CASH', 'CARD', 'CHECK', 'TRANSFER'])[(extract(epoch FROM a.start_at)::bigint / 1800 % 4) + 1],
               a.start_at + interval '1 hour', gen_random_uuid()
        FROM charges ch JOIN appointments a ON a.clinic_id = ch.clinic_id AND a.id = ch.appointment_id
        WHERE ch.clinic_id = ${c.id}`);
    });
    return actorFor((await createUser(t.ownerDb, c.id, 'DENTIST')).id, 'DENTIST', c.id);
  }

  // Mesures écrites dans la sortie des tests (et donc dans les journaux de la CI).
  const report = (line: string) => process.stdout.write(`${line}\n`);

  /** Durée et nombre de requêtes SQL d'un appel (toutes connexions du test). */
  async function measure<T>(run: () => Promise<T>) {
    type Query = (this: unknown, ...args: unknown[]) => unknown;
    const client = pg.Client.prototype as unknown as { query: Query };
    const original = client.query;
    let queries = 0;
    client.query = function (this: unknown, ...args: unknown[]) {
      queries += 1;
      return original.apply(this, args);
    };
    const started = performance.now();
    try {
      const result = await run();
      return { result, ms: Math.round(performance.now() - started), queries };
    } finally {
      client.query = original;
    }
  }

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
    const other = await createTestClinic(t.ownerDb, { timezone: 'Europe/Paris', currency: 'EUR' });
    dentist = await seed(clinic);
    await seed(other);
    const [row] = (
      await withTenant(t.appDb, clinic.id, (tx) =>
        tx.execute(sql`SELECT
          (SELECT count(*) FROM patients WHERE clinic_id = ${clinic.id})::int AS patients,
          (SELECT count(*) FROM appointments WHERE clinic_id = ${clinic.id})::int AS appointments,
          (SELECT count(*) FROM charges WHERE clinic_id = ${clinic.id})::int AS charges,
          (SELECT count(*) FROM payments WHERE clinic_id = ${clinic.id})::int AS payments`),
      )
    ).rows as Record<string, number>[];
    Object.assign(volumes, row);
    await t.ownerPool.query('ANALYZE');
  }, 180_000);
  afterAll(() => t.close());

  it('volume en place (par cabinet ; deux cabinets chargés)', () => {
    expect(volumes.patients).toBe(5000);
    expect(volumes.appointments).toBeGreaterThan(16_000);
    expect(volumes.payments).toBeGreaterThan(8_000);
    report(`[performance] volume par cabinet : ${JSON.stringify(volumes)}`);
  });

  it.each([
    ['jour', '2026-09-28', '2026-09-28'],
    ['semaine', '2026-09-28', '2026-10-04'],
    ['mois', '2026-09-01', '2026-09-30'],
    ['année', '2026-01-01', '2026-12-31'],
  ])('%s : temps borné, nombre de requêtes indépendant de la période', async (label, from, to) => {
    // Premier appel pour chauffer les connexions, puis mesure.
    await stats.dashboard(dentist, { from, to });
    const { result, ms, queries } = await measure(() => stats.dashboard(dentist, { from, to }));
    report(`[performance] tableau de bord (${label}) : ${ms} ms, ${queries} requêtes`);
    expect(result.activity!.total).toBeGreaterThan(0);
    expect(queries).toBeLessThanOrEqual(25);
    // Plafond large pour une machine de CI partagée ; mesuré bien plus bas en local.
    expect(ms).toBeLessThan(3000);
  });

  it('année avec filtre praticien, et page « Revenus » d’une année : mêmes garanties', async () => {
    const practitionerId = (
      await practitionersService.listPractitioners(dentist, { includeArchived: false })
    )[0]!.id;
    const filtered = await measure(() =>
      stats.dashboard(dentist, { from: '2026-01-01', to: '2026-12-31', practitionerId }),
    );
    report(
      `[performance] tableau de bord (année, un praticien) : ${filtered.ms} ms, ${filtered.queries} requêtes`,
    );
    expect(filtered.queries).toBeLessThanOrEqual(25);
    expect(filtered.ms).toBeLessThan(3000);
    const revenue = await measure(() =>
      finance.revenue(dentist, { from: '2026-01-01', to: '2026-12-31' }),
    );
    report(
      `[performance] revenus (année) : ${revenue.ms} ms, ${revenue.queries} requêtes, ${revenue.result.paymentsCount} paiements`,
    );
    expect(revenue.queries).toBeLessThanOrEqual(12);
    expect(revenue.ms).toBeLessThan(3000);
  });
});
