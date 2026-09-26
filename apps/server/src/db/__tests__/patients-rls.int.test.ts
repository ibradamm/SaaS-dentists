import { randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../test/actors';
import { META, createUser } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { createSecretBox } from '../../lib/secret-box';
import { createImportsService } from '../../modules/imports/imports.service';
import { createPatientsService } from '../../modules/patients/patients.service';
import type { Clinic } from '../schema';
import { withTenant } from '../tenant';

/**
 * Isolation des tables patients et import au niveau de la base, en SQL brut : les services
 * filtrent aussi par cabinet, ce test vérifie que la RLS protège seule si ce filtre manquait.
 */
describe('isolation des tables patients et import (RLS)', () => {
  const t = openTestDatabase();
  const secretBox = createSecretBox(randomBytes(32));
  const patientsService = createPatientsService({ db: t.appDb, secretBox });
  const imports = createImportsService({ db: t.appDb });
  const TABLES = [
    'patients',
    'patient_contacts',
    'patient_medical_notes',
    'import_batches',
    'import_rows',
  ] as const;

  let a: Clinic;
  let b: Clinic;
  let adminB: string;
  let patientB: string;
  let batchB: string;

  beforeAll(async () => {
    a = await createTestClinic(t.ownerDb);
    b = await createTestClinic(t.ownerDb);
    const adminA = actorFor((await createUser(t.ownerDb, a.id, 'ADMIN')).id, 'ADMIN', a.id);
    adminB = (await createUser(t.ownerDb, b.id, 'ADMIN')).id;
    const actorB = actorFor(adminB, 'ADMIN', b.id);

    for (const actor of [adminA, actorB]) {
      const patient = await patientsService.create(
        actor,
        { lastName: 'Durand', firstName: 'Paul', contacts: [{ phone: '06 11 22 33 44' }] },
        META,
      );
      await patientsService.addMedicalNote(actor, patient.id, 'Note confidentielle', META);
      const batch = await imports.create(
        actor,
        { kind: 'PATIENTS', fileName: 'export.csv', totalRows: 1, dateFormat: 'DD/MM/YYYY' },
        META,
      );
      await imports.addRows(actor, batch.id, {
        rows: [{ line: 2, lastName: 'Morel', firstName: 'Anne' }],
      });
      if (actor === actorB) {
        patientB = patient.id;
        batchB = batch.id;
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
      patients: sql`INSERT INTO patients (id, clinic_id, last_name, first_name, created_source, search_text)
        VALUES (gen_random_uuid(), ${b.id}, 'X', 'Y', 'STAFF', 'x y')`,
      patient_contacts: sql`INSERT INTO patient_contacts (id, clinic_id, patient_id, phone_e164)
        VALUES (gen_random_uuid(), ${b.id}, ${patientB}, '+33699887766')`,
      patient_medical_notes: sql`INSERT INTO patient_medical_notes (id, clinic_id, patient_id, author_user_id, content_enc)
        VALUES (gen_random_uuid(), ${b.id}, ${patientB}, ${adminB}, 'x')`,
      import_batches: sql`INSERT INTO import_batches (id, clinic_id, kind, file_name, date_format, total_rows, counts, created_by)
        VALUES (gen_random_uuid(), ${b.id}, 'PATIENTS', 'f.csv', 'DD/MM/YYYY', 1, '{}'::jsonb, ${adminB})`,
      import_rows: sql`INSERT INTO import_rows (id, clinic_id, batch_id, line, status)
        VALUES (gen_random_uuid(), ${b.id}, ${batchB}, 3, 'VALID')`,
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
      }).toEqual({
        table,
        cause: '42501',
      });
    }
  });

  it('dans le contexte A, les lignes de B ne peuvent être ni modifiées ni supprimées', async () => {
    const writes = [
      sql`UPDATE patients SET last_name = 'Pirate' WHERE id = ${patientB}`,
      sql`DELETE FROM patients WHERE clinic_id = ${b.id}`,
      sql`UPDATE patient_contacts SET label = 'Pirate' WHERE patient_id = ${patientB}`,
      sql`DELETE FROM patient_contacts WHERE patient_id = ${patientB}`,
      sql`UPDATE import_batches SET status = 'DISCARDED' WHERE id = ${batchB}`,
      sql`UPDATE import_rows SET status = 'INVALID' WHERE batch_id = ${batchB}`,
      sql`DELETE FROM import_rows WHERE batch_id = ${batchB}`,
    ];
    for (const query of writes) expect((await inA(query)).rowCount).toBe(0);

    const inB = (table: string) => countIn(b.id, table).then((r) => r.n);
    expect(await Promise.all(TABLES.map(inB))).toEqual([1, 1, 1, 1, 1]);
    const [row] = await withTenant(t.appDb, b.id, (tx) =>
      tx.execute(sql`SELECT last_name FROM patients WHERE id = ${patientB}`),
    ).then((r) => r.rows);
    expect(row).toEqual({ last_name: 'Durand' });
  });
});
