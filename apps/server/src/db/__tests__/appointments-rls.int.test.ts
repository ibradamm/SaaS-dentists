import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../test/actors';
import { META, createUser, testClock } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { createSecretBox } from '../../lib/secret-box';
import { createPatientsService } from '../../modules/patients/patients.service';
import { createPractitionersService } from '../../modules/scheduling/practitioners.service';
import type { Clinic } from '../schema';
import { withTenant } from '../tenant';

/**
 * Garanties de la base pour les rendez-vous, en SQL brut (sans le service) : isolation,
 * anti double réservation, occupies_slot imposé par le déclencheur, pas de suppression.
 */
describe('rendez-vous : garanties de la base', () => {
  const t = openTestDatabase();
  const clock = testClock(new Date('2026-09-28T06:00:00Z'));
  const practitionersService = createPractitionersService({ db: t.appDb, now: clock.now });
  const patientsService = createPatientsService({
    db: t.appDb,
    now: clock.now,
    secretBox: createSecretBox(randomBytes(32)),
  });

  interface Fixture {
    clinic: Clinic;
    practitioner: string;
    otherPractitioner: string;
    patients: string[];
    type: string;
  }
  let a: Fixture;
  let b: Fixture;

  async function fixture(): Promise<Fixture> {
    const clinic = await createTestClinic(t.ownerDb);
    const admin = actorFor(
      (await createUser(t.ownerDb, clinic.id, 'ADMIN')).id,
      'ADMIN',
      clinic.id,
    );
    const practitioner = (
      await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr Test', color: '#0ea5e9' },
        META,
      )
    ).id;
    const otherPractitioner = (
      await practitionersService.createPractitioner(
        admin,
        { displayName: 'Dr Autre', color: '#10b981' },
        META,
      )
    ).id;
    const type = (
      await practitionersService.createType(
        admin,
        { name: 'Contrôle', durationMinutes: 30, color: '#10b981' },
        META,
      )
    ).id;
    const patients: string[] = [];
    for (const firstName of ['Un', 'Deux', 'Trois']) {
      patients.push(
        (await patientsService.create(admin, { lastName: 'Test', firstName, contacts: [] }, META))
          .id,
      );
    }
    return { clinic, practitioner, otherPractitioner, patients, type };
  }

  beforeAll(async () => {
    a = await fixture();
    b = await fixture();
  });
  afterAll(() => t.close());

  const run = (f: Fixture, query: SQL) =>
    withTenant(t.appDb, f.clinic.id, (tx) => tx.execute(query));
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e: unknown) => (e as { cause?: { code?: string } }).cause?.code ?? 'inconnu',
    );
  const insert = (
    f: Fixture,
    patient: number,
    start: string,
    end: string,
    extra: SQL = sql``,
    extraValues: SQL = sql``,
  ) =>
    run(
      f,
      sql`INSERT INTO appointments (id, practitioner_id, patient_id, appointment_type_id, start_at, end_at${extra})
          VALUES (gen_random_uuid(), ${f.practitioner}, ${f.patients[patient]}, ${f.type}, ${start}, ${end}${extraValues})
          RETURNING id, status, occupies_slot`,
    );

  it('anti double réservation : chevauchement refusé par la base, plages adjacentes permises', async () => {
    await insert(a, 0, '2026-10-01T08:00Z', '2026-10-01T08:30Z');
    await insert(a, 1, '2026-10-01T08:30Z', '2026-10-01T09:00Z');
    // 23P01 : violation de contrainte d'exclusion.
    expect(await failure(insert(a, 2, '2026-10-01T08:15Z', '2026-10-01T08:45Z'))).toBe('23P01');
    // Même patient au même moment chez un autre praticien : refusé par la base aussi.
    expect(
      await failure(
        run(
          a,
          sql`INSERT INTO appointments (id, practitioner_id, patient_id, appointment_type_id, start_at, end_at)
              VALUES (gen_random_uuid(), ${a.otherPractitioner}, ${a.patients[0]}, ${a.type}, '2026-10-01T08:10Z', '2026-10-01T08:20Z')`,
        ),
      ),
    ).toBe('23P01');
    // Autre patient chez l'autre praticien au même moment : accepté.
    await run(
      a,
      sql`INSERT INTO appointments (id, practitioner_id, patient_id, appointment_type_id, start_at, end_at)
          VALUES (gen_random_uuid(), ${a.otherPractitioner}, ${a.patients[2]}, ${a.type}, '2026-10-01T08:00Z', '2026-10-01T08:30Z')`,
    );
  });

  it('occupies_slot est imposé par le déclencheur, quelle que soit la valeur fournie', async () => {
    const result = await insert(
      a,
      2,
      '2026-10-01T10:00Z',
      '2026-10-01T10:30Z',
      sql`, occupies_slot`,
      sql`, false`,
    );
    expect(result.rows[0]).toMatchObject({ status: 'SCHEDULED', occupies_slot: true });
    expect(await failure(insert(a, 1, '2026-10-01T10:00Z', '2026-10-01T10:30Z'))).toBe('23P01');
  });

  it('un rendez-vous annulé ou « patient absent » ne bloque pas le créneau', async () => {
    for (const status of ['CANCELLED', 'NO_SHOW']) {
      const inserted = await insert(
        a,
        0,
        '2026-10-02T08:00Z',
        '2026-10-02T08:30Z',
        sql`, status`,
        sql`, ${status}`,
      );
      expect(inserted.rows[0]).toMatchObject({ status, occupies_slot: false });
    }
    await insert(a, 1, '2026-10-02T08:00Z', '2026-10-02T08:30Z');
  });

  it('grille de 5 minutes et durée maximale imposées par la base', async () => {
    // 23514 : violation de contrainte CHECK.
    expect(await failure(insert(a, 0, '2026-10-03T08:02Z', '2026-10-03T08:30Z'))).toBe('23514');
    expect(await failure(insert(a, 0, '2026-10-03T08:00Z', '2026-10-03T17:00Z'))).toBe('23514');
  });

  it('ni suppression, ni modification directe de occupies_slot ou du patient, ni ajout de statut', async () => {
    // 42501 : droit refusé.
    for (const query of [
      sql`DELETE FROM appointments`,
      sql`UPDATE appointments SET occupies_slot = false`,
      sql`UPDATE appointments SET patient_id = ${a.patients[1]}`,
      sql`INSERT INTO appointment_statuses (code, occupies_slot, sort_order) VALUES ('PIRATE', false, 99)`,
    ]) {
      expect(await failure(run(a, query))).toBe('42501');
    }
  });

  it('isolation : un cabinet ne voit, ne crée ni ne modifie les rendez-vous d’un autre', async () => {
    await insert(b, 0, '2026-10-01T08:00Z', '2026-10-01T08:30Z');
    const seen = await run(
      a,
      sql`SELECT count(*) FILTER (WHERE clinic_id <> ${a.clinic.id})::int AS n FROM appointments`,
    );
    expect(seen.rows[0]).toEqual({ n: 0 });
    expect(
      await failure(
        run(
          a,
          sql`INSERT INTO appointments (id, clinic_id, practitioner_id, patient_id, appointment_type_id, start_at, end_at)
              VALUES (gen_random_uuid(), ${b.clinic.id}, ${b.practitioner}, ${b.patients[1]}, ${b.type}, '2026-10-05T08:00Z', '2026-10-05T08:30Z')`,
        ),
      ),
    ).toBe('42501');
    // Rendez-vous de A avec un patient de B : la clé composite le refuse (23503).
    expect(
      await failure(
        run(
          a,
          sql`INSERT INTO appointments (id, practitioner_id, patient_id, appointment_type_id, start_at, end_at)
              VALUES (gen_random_uuid(), ${a.practitioner}, ${b.patients[2]}, ${a.type}, '2026-10-05T08:00Z', '2026-10-05T08:30Z')`,
        ),
      ),
    ).toBe('23503');
    const updated = await run(
      a,
      sql`UPDATE appointments SET note = 'pirate' WHERE clinic_id = ${b.clinic.id}`,
    );
    expect(updated.rowCount).toBe(0);
  });

  it('les statuts sont lisibles sans contexte de cabinet, avec leur effet sur le créneau', async () => {
    const { rows } = await t.appDb.execute(
      sql`SELECT code, occupies_slot FROM appointment_statuses ORDER BY sort_order`,
    );
    expect(rows).toEqual([
      { code: 'SCHEDULED', occupies_slot: true },
      { code: 'COMPLETED', occupies_slot: true },
      { code: 'NO_SHOW', occupies_slot: false },
      { code: 'CANCELLED', occupies_slot: false },
    ]);
  });
});
