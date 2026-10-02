import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../test/actors';
import { META, createUser, testClock } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { createPractitionersService } from '../../modules/scheduling/practitioners.service';
import { createSchedulesService } from '../../modules/scheduling/schedules.service';
import type { Clinic } from '../schema';
import { withTenant } from '../tenant';

/**
 * Isolation des tables d'agenda au niveau de la base, en SQL brut : les services filtrent aussi
 * par cabinet ; ce test vérifie que la RLS protège seule si ce filtre manquait.
 */
describe("isolation des tables d'agenda (RLS)", () => {
  const t = openTestDatabase();
  const clock = testClock(new Date('2026-09-26T10:00:00Z'));
  const practitionersService = createPractitionersService({ db: t.appDb, now: clock.now });
  const schedules = createSchedulesService({ db: t.appDb, now: clock.now });
  const TABLES = [
    'practitioners',
    'appointment_types',
    'working_schedules',
    'working_intervals',
    'availability_blocks',
  ] as const;

  let a: Clinic;
  let b: Clinic;
  let practitionerB: string;
  let scheduleB: string;

  beforeAll(async () => {
    a = await createTestClinic(t.ownerDb);
    b = await createTestClinic(t.ownerDb);
    for (const clinic of [a, b]) {
      const admin = actorFor(
        (await createUser(t.ownerDb, clinic.id, 'ADMIN')).id,
        'ADMIN',
        clinic.id,
      );
      const practitioner = await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr Test', color: '#0ea5e9' },
        META,
      );
      await practitionersService.createType(
        admin,
        { name: 'Contrôle', durationMinutes: 30, color: '#10b981' },
        META,
      );
      const [period] = (
        await schedules.setSchedule(
          admin,
          practitioner.id,
          {
            validFrom: '2026-09-28',
            basePeriod: null,
            intervals: [{ weekday: 1, start: '09:00', end: '12:00' }],
          },
          META,
        )
      ).periods;
      await schedules.createBlock(
        admin,
        {
          practitionerId: practitioner.id,
          kind: 'ABSENCE',
          allDay: true,
          startDate: '2026-10-05',
          endDate: '2026-10-05',
        },
        META,
      );
      if (clinic === b) {
        practitionerB = practitioner.id;
        scheduleB = period!.id;
      }
    }
  });
  afterAll(() => t.close());

  const countIn = (clinicId: string | null, table: string) => {
    const query = sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE clinic_id <> ${a.id})::int AS foreign FROM ${sql.identifier(table)}`;
    return (
      clinicId ? withTenant(t.appDb, clinicId, (tx) => tx.execute(query)) : t.appDb.execute(query)
    ).then((r) => r.rows[0] as { n: number; foreign: number });
  };
  const inA = (query: SQL) => withTenant(t.appDb, a.id, (tx) => tx.execute(query));

  it('sans contexte cabinet, le rôle applicatif ne voit aucune ligne', async () => {
    for (const table of TABLES) {
      expect({ table, ...(await countIn(null, table)) }).toEqual({ table, n: 0, foreign: 0 });
    }
  });

  it('dans le contexte A, seules les lignes de A sont visibles', async () => {
    for (const table of TABLES) {
      const { n, foreign } = await countIn(a.id, table);
      expect({ table, visible: n > 0, foreign }).toEqual({ table, visible: true, foreign: 0 });
    }
  });

  it("dans le contexte A, aucune insertion n'est possible pour le cabinet B", async () => {
    const attempts: Record<(typeof TABLES)[number], SQL> = {
      practitioners: sql`INSERT INTO practitioners (id, clinic_id, display_name, color)
        VALUES (gen_random_uuid(), ${b.id}, 'Pirate', '#000000')`,
      appointment_types: sql`INSERT INTO appointment_types (id, clinic_id, name, duration_minutes, color)
        VALUES (gen_random_uuid(), ${b.id}, 'Pirate', 30, '#000000')`,
      working_schedules: sql`INSERT INTO working_schedules (id, clinic_id, practitioner_id, valid_from)
        VALUES (gen_random_uuid(), ${b.id}, ${practitionerB}, '2030-01-01')`,
      working_intervals: sql`INSERT INTO working_intervals (id, clinic_id, schedule_id, weekday, start_minute, end_minute)
        VALUES (gen_random_uuid(), ${b.id}, ${scheduleB}, 2, 600, 660)`,
      availability_blocks: sql`INSERT INTO availability_blocks (id, clinic_id, practitioner_id, kind, start_at, end_at)
        VALUES (gen_random_uuid(), ${b.id}, ${practitionerB}, 'ABSENCE', now(), now() + interval '1 hour')`,
    };
    for (const [table, query] of Object.entries(attempts)) {
      const error: unknown = await inA(query).then(
        () => null,
        (e: unknown) => e,
      );
      // 42501 : « new row violates row-level security policy ».
      expect({
        table,
        cause: (error as { cause?: { code?: string } } | null)?.cause?.code,
      }).toEqual({ table, cause: '42501' });
    }
  });

  it('dans le contexte A, les lignes de B ne peuvent être ni modifiées ni supprimées', async () => {
    const writes = [
      sql`UPDATE practitioners SET display_name = 'Pirate' WHERE clinic_id = ${b.id}`,
      sql`UPDATE appointment_types SET name = 'Pirate' WHERE clinic_id = ${b.id}`,
      sql`UPDATE working_schedules SET valid_to = '2026-10-01' WHERE clinic_id = ${b.id}`,
      sql`DELETE FROM working_schedules WHERE clinic_id = ${b.id}`,
      sql`DELETE FROM working_intervals WHERE clinic_id = ${b.id}`,
      sql`UPDATE availability_blocks SET label = 'Pirate' WHERE clinic_id = ${b.id}`,
      sql`DELETE FROM availability_blocks WHERE clinic_id = ${b.id}`,
    ];
    for (const query of writes) expect((await inA(query)).rowCount).toBe(0);
    const inB = (table: string) => countIn(b.id, table).then((r) => r.n);
    expect(await Promise.all(TABLES.map(inB))).toEqual([1, 1, 1, 1, 1]);
  });

  it('le rôle applicatif ne peut supprimer ni praticien ni type de rendez-vous (archivage seulement)', async () => {
    for (const table of ['practitioners', 'appointment_types']) {
      const error: unknown = await inA(sql`DELETE FROM ${sql.identifier(table)}`).then(
        () => null,
        (e: unknown) => e,
      );
      // 42501 : permission refusée (aucun droit DELETE accordé).
      expect({
        table,
        cause: (error as { cause?: { code?: string } } | null)?.cause?.code,
      }).toEqual({ table, cause: '42501' });
    }
  });
});
