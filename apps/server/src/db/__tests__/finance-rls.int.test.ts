import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../test/actors';
import { META, createUser, testClock } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { createSecretBox } from '../../lib/secret-box';
import { createPatientsService } from '../../modules/patients/patients.service';
import type { Clinic } from '../schema';
import { withTenant } from '../tenant';

/**
 * Garanties financières de la base, en SQL brut (sans le service, docs/adr/0009) : jamais plus
 * payé que dû, transitions définitives, aucune modification ni suppression, clés composites,
 * isolation entre cabinets, encaissements simultanés sérialisés.
 */
describe('paiements : garanties de la base', () => {
  const t = openTestDatabase({ appPoolMax: 6 });
  const clock = testClock(new Date('2026-09-28T06:00:00Z'));
  const patientsService = createPatientsService({
    db: t.appDb,
    now: clock.now,
    secretBox: createSecretBox(randomBytes(32)),
  });

  interface Fixture {
    clinic: Clinic;
    userId: string;
    patients: string[];
  }
  let a: Fixture;
  let b: Fixture;

  async function fixture(): Promise<Fixture> {
    const clinic = await createTestClinic(t.ownerDb);
    const userId = (await createUser(t.ownerDb, clinic.id, 'ADMIN')).id;
    const admin = actorFor(userId, 'ADMIN', clinic.id);
    const patients: string[] = [];
    for (const firstName of ['Un', 'Deux']) {
      patients.push(
        (await patientsService.create(admin, { lastName: 'Compte', firstName, contacts: [] }, META))
          .id,
      );
    }
    return { clinic, userId, patients };
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
  const charge = async (f: Fixture, amount = 6000, patient = 0) =>
    (
      await run(
        f,
        sql`INSERT INTO charges (id, patient_id, label, amount_cents, currency, idempotency_key)
            VALUES (gen_random_uuid(), ${f.patients[patient]}, 'Acte', ${amount}, 'EUR', gen_random_uuid())
            RETURNING id`,
      )
    ).rows[0]!.id as string;
  const pay = (f: Fixture, chargeId: string, amount: number, patient = 0, currency = 'EUR') =>
    run(
      f,
      sql`INSERT INTO payments (id, patient_id, charge_id, amount_cents, currency, method, idempotency_key)
          VALUES (gen_random_uuid(), ${f.patients[patient]}, ${chargeId}, ${amount}, ${currency}, 'CASH', gen_random_uuid())
          RETURNING id`,
    ).then((r) => r.rows[0]!.id as string);
  const voidPayment = (f: Fixture, id: string) =>
    run(
      f,
      sql`UPDATE payments SET status = 'VOIDED', voided_at = now(), voided_by = ${f.userId}, void_reason = 'Erreur de saisie'
          WHERE id = ${id}`,
    );
  const cancelCharge = (f: Fixture, id: string) =>
    run(
      f,
      sql`UPDATE charges SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = ${f.userId}, cancellation_reason = 'Erreur de saisie'
          WHERE id = ${id}`,
    );

  it('jamais plus payé que dû : paiements partiels jusqu’au montant exact, puis refus', async () => {
    const c = await charge(a, 6000);
    await pay(a, c, 2000);
    await pay(a, c, 4000);
    // DF001 : paiement supérieur au restant dû.
    expect(await failure(pay(a, c, 1))).toBe('DF001');
    // Un paiement annulé libère la place qu'il occupait.
    const extra = await charge(a, 1000);
    const first = await pay(a, extra, 1000);
    await voidPayment(a, first);
    await pay(a, extra, 1000);
  });

  it('transitions définitives : pas de retour d’un paiement annulé, pas de montant dû ré-ouvert', async () => {
    const c = await charge(a, 3000);
    const p = await pay(a, c, 3000);
    // DF003 : un montant dû payé ne s'annule pas.
    expect(await failure(cancelCharge(a, c))).toBe('DF003');
    await voidPayment(a, p);
    // DF004 : un paiement annulé ne redevient pas encaissé, ni ne se ré-annule.
    expect(
      await failure(run(a, sql`UPDATE payments SET status = 'RECORDED' WHERE id = ${p}`)),
    ).toBe('DF004');
    expect(await failure(voidPayment(a, p))).toBe('DF004');
    await cancelCharge(a, c);
    // DF002 : pas de paiement sur un montant dû annulé ; DF004 : pas de retour à « ouvert ».
    expect(await failure(pay(a, c, 100))).toBe('DF002');
    expect(await failure(run(a, sql`UPDATE charges SET status = 'OPEN' WHERE id = ${c}`))).toBe(
      'DF004',
    );
    // Création directement annulée ou déjà annulée : refusée.
    expect(
      await failure(
        run(
          a,
          sql`INSERT INTO payments (id, patient_id, charge_id, amount_cents, currency, method, idempotency_key, status, voided_at, voided_by, void_reason)
              VALUES (gen_random_uuid(), ${a.patients[0]}, ${await charge(a)}, 100, 'EUR', 'CASH', gen_random_uuid(), 'VOIDED', now(), ${a.userId}, 'Test')`,
        ),
      ),
    ).toBe('DF004');
  });

  it('annulation : motif, date et auteur obligatoires (contrainte de cohérence)', async () => {
    const c = await charge(a, 500);
    const p = await pay(a, c, 500);
    // 23514 : violation de contrainte CHECK.
    expect(await failure(run(a, sql`UPDATE payments SET status = 'VOIDED' WHERE id = ${p}`))).toBe(
      '23514',
    );
  });

  it('aucune modification ni suppression de donnée financière par le rôle applicatif', async () => {
    const c = await charge(a, 700);
    const p = await pay(a, c, 700);
    // 42501 : droit refusé.
    for (const query of [
      sql`DELETE FROM payments WHERE id = ${p}`,
      sql`DELETE FROM charges WHERE id = ${c}`,
      sql`UPDATE payments SET amount_cents = 1 WHERE id = ${p}`,
      sql`UPDATE payments SET method = 'CARD' WHERE id = ${p}`,
      sql`UPDATE payments SET received_at = now() - interval '1 year' WHERE id = ${p}`,
      sql`UPDATE payments SET patient_id = ${a.patients[1]} WHERE id = ${p}`,
      sql`UPDATE charges SET amount_cents = 1 WHERE id = ${c}`,
      sql`UPDATE charges SET label = 'Autre' WHERE id = ${c}`,
      sql`UPDATE charges SET patient_id = ${a.patients[1]} WHERE id = ${c}`,
    ]) {
      expect(await failure(run(a, query))).toBe('42501');
    }
  });

  it('même patient et même devise : clés composites et déclencheur', async () => {
    const c = await charge(a, 1000, 0);
    // 23503 : paiement d'un autre patient sur ce montant dû.
    expect(await failure(pay(a, c, 100, 1))).toBe('23503');
    // DF005 : devise différente.
    expect(await failure(pay(a, c, 100, 0, 'USD'))).toBe('DF005');
    // Montant nul ou négatif : 23514.
    expect(await failure(pay(a, c, 0))).toBe('23514');
    expect(await failure(charge(a, -5))).toBe('23514');
  });

  it('isolation : un cabinet ne voit ni ne paie les montants dus d’un autre', async () => {
    const cb = await charge(b, 2000);
    const seen = await run(
      a,
      sql`SELECT (SELECT count(*) FROM charges WHERE clinic_id <> ${a.clinic.id})::int
               + (SELECT count(*) FROM payments WHERE clinic_id <> ${a.clinic.id})::int AS n`,
    );
    expect(seen.rows[0]).toEqual({ n: 0 });
    // Paiement du cabinet A sur un montant dû du cabinet B : clé composite (23503).
    expect(await failure(pay(a, cb, 100))).toBe('23503');
    // Ligne écrite au nom du cabinet B depuis le cabinet A : RLS (42501).
    expect(
      await failure(
        run(
          a,
          sql`INSERT INTO charges (id, clinic_id, patient_id, label, amount_cents, currency, idempotency_key)
              VALUES (gen_random_uuid(), ${b.clinic.id}, ${b.patients[0]}, 'Acte', 100, 'EUR', gen_random_uuid())`,
        ),
      ),
    ).toBe('42501');
  });

  it('deux encaissements simultanés sur le même montant dû : le second attend, puis est refusé', async () => {
    const c = await charge(a, 6000);
    const [one, two] = [await t.appPool.connect(), await t.appPool.connect()];
    const insert = `INSERT INTO payments (id, patient_id, charge_id, amount_cents, currency, method, idempotency_key)
                    VALUES (gen_random_uuid(), $1, $2, $3, 'EUR', 'CARD', gen_random_uuid())`;
    try {
      for (const client of [one, two]) {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.clinic_id', $1, true)", [a.clinic.id]);
      }
      await one.query(insert, [a.patients[0], c, 4000]);
      // 4 000 + 3 000 > 6 000 : le second encaissement doit attendre le premier, puis échouer.
      const second = two.query(insert, [a.patients[0], c, 3000]).then(
        () => 'accepté',
        (e: { code?: string }) => e.code,
      );
      for (let i = 0; i < 50; i += 1) {
        const { rows } = await t.ownerPool.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
        );
        if (rows[0]!.n > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await one.query('COMMIT');
      expect(await second).toBe('DF001');
      await two.query('ROLLBACK');
    } finally {
      one.release();
      two.release();
    }
    const total = await run(
      a,
      sql`SELECT coalesce(sum(amount_cents), 0)::int AS paid FROM payments WHERE charge_id = ${c} AND status = 'RECORDED'`,
    );
    expect(total.rows[0]).toEqual({ paid: 4000 });
  });

  it.each([
    ['encaissement puis annulation', 'pay', 'DF003'],
    ['annulation puis encaissement', 'cancel', 'DF002'],
  ] as const)(
    'annulation et encaissement simultanés (%s) : le second attend, puis est refusé',
    async (_, first, expected) => {
      const c = await charge(a, 3000);
      const pay = `INSERT INTO payments (id, patient_id, charge_id, amount_cents, currency, method, idempotency_key)
                   VALUES (gen_random_uuid(), $1, $2, 1000, 'EUR', 'CARD', gen_random_uuid())`;
      const cancel = `UPDATE charges SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $1,
                        cancellation_reason = 'Erreur de saisie' WHERE id = $2`;
      const statements = {
        pay: [pay, [a.patients[0], c]],
        cancel: [cancel, [a.userId, c]],
      } as const;
      const second = first === 'pay' ? 'cancel' : 'pay';
      const [one, two] = [await t.appPool.connect(), await t.appPool.connect()];
      try {
        for (const client of [one, two]) {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.clinic_id', $1, true)", [a.clinic.id]);
        }
        await one.query(statements[first][0], [...statements[first][1]]);
        const pending = two.query(statements[second][0], [...statements[second][1]]).then(
          () => 'accepté',
          (e: { code?: string }) => e.code,
        );
        for (let i = 0; i < 50; i += 1) {
          const { rows } = await t.ownerPool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()",
          );
          if (rows[0]!.n > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        await one.query('COMMIT');
        expect(await pending).toBe(expected);
        await two.query('ROLLBACK');
      } finally {
        one.release();
        two.release();
      }
      // Jamais un acte annulé portant un paiement valide.
      const state = await run(
        a,
        sql`SELECT c.status, (SELECT count(*)::int FROM payments p WHERE p.charge_id = c.id AND p.status = 'RECORDED') AS paid
            FROM charges c WHERE c.id = ${c}`,
      );
      expect(state.rows[0]).toEqual(
        first === 'pay' ? { status: 'OPEN', paid: 1 } : { status: 'CANCELLED', paid: 0 },
      );
    },
  );
});
