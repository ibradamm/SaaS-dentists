import { randomBytes, randomUUID } from 'node:crypto';
import type { ImportRowInput } from '@dental/shared';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser, testClock } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import {
  auditLogs,
  importRows,
  patientContacts,
  patientMedicalNotes,
  patients,
  type Clinic,
} from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import { createSecretBox } from '../../../lib/secret-box';
import type { UserActor } from '../../auth/auth.types';
import { createPatientsService } from '../../patients/patients.service';
import { createImportsService } from '../imports.service';

describe('import de patients (fichiers CSV / Excel)', () => {
  const t = openTestDatabase();
  const clock = testClock(new Date('2026-09-27T09:00:00Z'));
  const imports = createImportsService({ db: t.appDb, now: clock.now });
  const patientsService = createPatientsService({
    db: t.appDb,
    secretBox: createSecretBox(randomBytes(32)),
    now: clock.now,
  });
  let clinic: Clinic;
  let admin: UserActor;

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
    admin = actorFor((await createUser(t.ownerDb, clinic.id, 'ADMIN')).id, 'ADMIN', clinic.id);
  });
  afterAll(() => t.close());

  const rows = (list: Omit<ImportRowInput, 'line'>[]): ImportRowInput[] =>
    list.map((r, i) => ({ line: i + 2, ...r }));
  const start = (totalRows: number) =>
    imports.create(
      admin,
      { kind: 'PATIENTS', fileName: 'export.csv', totalRows, dateFormat: 'DD/MM/YYYY' },
      META,
    );

  it('parcours complet : validation, doublons, rapport, création, effacement des données intermédiaires', async () => {
    await patientsService.create(
      admin,
      { lastName: 'Existant', firstName: 'Paul', birthDate: '1970-01-01' },
      META,
    );
    await patientsService.create(admin, { lastName: 'Sansdate', firstName: 'Lina' }, META);
    const batch = await start(6);
    const summary = await imports.addRows(admin, batch.id, {
      rows: rows([
        {
          lastName: 'Bernard',
          firstName: 'Chloé',
          birthDate: '02/03/1990',
          phones: ['06 11 22 33 44', '01 45 67 89 10'],
          email: 'chloe@exemple.fr',
          externalRef: 'P-1',
        },
        { lastName: 'Sans prénom', phones: [] },
        { lastName: 'BERNARD', firstName: 'chloe', birthDate: '1990-03-02', phones: [] },
        { lastName: 'Existant', firstName: 'Paul', birthDate: '01/01/1970', phones: [] },
        { lastName: 'Sansdate', firstName: 'Lina', birthDate: '05/05/2001', phones: [] },
        { lastName: 'Petit', firstName: 'Noé', phones: ['123'], email: 'faux' },
      ]),
    });
    expect(summary.counts).toMatchObject({
      received: 6,
      valid: 3,
      invalid: 1,
      duplicateInFile: 1,
      existing: 1,
      withWarnings: 2,
    });

    const report = await imports.report(admin, batch.id, {});
    const byLine = Object.fromEntries(
      report.rows.map((r) => [r.line, r.issues.map((i) => i.code)]),
    );
    expect(byLine).toEqual({
      3: ['REQUIRED'],
      4: ['DUPLICATE_IN_FILE'],
      5: ['EXISTING_PATIENT'],
      6: ['POSSIBLE_DUPLICATE'],
      7: ['INVALID_PHONE', 'INVALID_EMAIL'],
    });
    // Le rapport ne contient que des codes, jamais de valeurs.
    expect(JSON.stringify(report)).not.toMatch(/Bernard|Chloé|faux|123/);

    const committed = await imports.commit(admin, batch.id, META);
    expect(committed).toMatchObject({ status: 'COMMITTED', counts: { created: 3 } });
    const created = await withTenant(t.appDb, clinic.id, (tx) =>
      tx.select().from(patients).where(eq(patients.importBatchId, batch.id)),
    );
    expect(created.map((p) => p.lastName).sort()).toEqual(['Bernard', 'Petit', 'Sansdate']);
    const bernard = created.find((p) => p.lastName === 'Bernard')!;
    expect(bernard).toMatchObject({
      createdSource: 'IMPORT',
      externalRef: 'P-1',
      birthDate: '1990-03-02',
      email: 'chloe@exemple.fr',
      version: 1,
    });
    const contacts = await withTenant(t.appDb, clinic.id, (tx) =>
      // Ordre explicite (celui du service) : sans ORDER BY, PostgreSQL ne garantit aucun ordre.
      tx
        .select()
        .from(patientContacts)
        .where(eq(patientContacts.patientId, bernard.id))
        .orderBy(desc(patientContacts.isPrimary), asc(patientContacts.createdAt)),
    );
    expect(contacts.map((c) => [c.phoneE164, c.isPrimary])).toEqual([
      ['+33611223344', true],
      ['+33145678910', false],
    ]);
    const leftovers = await withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select()
        .from(importRows)
        .where(and(eq(importRows.batchId, batch.id), isNotNull(importRows.data))),
    );
    expect(leftovers).toEqual([]);
    const audit = await withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, batch.id), eq(auditLogs.action, 'import.committed'))),
    );
    expect(audit).toHaveLength(1);
  });

  it('un patient créé entre l’envoi des lignes et la validation n’est pas dupliqué', async () => {
    const batch = await start(1);
    await imports.addRows(admin, batch.id, {
      rows: rows([{ lastName: 'Tardif', firstName: 'Jules', birthDate: '10/10/2010', phones: [] }]),
    });
    await patientsService.create(
      admin,
      { lastName: 'Tardif', firstName: 'Jules', birthDate: '2010-10-10' },
      META,
    );
    const committed = await imports.commit(admin, batch.id, META);
    expect(committed.counts).toMatchObject({ created: 0, existing: 1 });
  });

  it('refuse de valider un import incomplet, un excès de lignes ou une ligne reçue deux fois', async () => {
    const batch = await start(2);
    await imports.addRows(admin, batch.id, {
      rows: [{ line: 2, lastName: 'A', firstName: 'B', phones: [] }],
    });
    await expect(imports.commit(admin, batch.id, META)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      imports.addRows(admin, batch.id, {
        rows: [{ line: 2, lastName: 'A', firstName: 'B', phones: [] }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      imports.addRows(admin, batch.id, {
        rows: [
          { line: 3, lastName: 'C', firstName: 'D', phones: [] },
          { line: 4, lastName: 'E', firstName: 'F', phones: [] },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it("l'annulation supprime les patients intacts et conserve ceux modifiés depuis l'import", async () => {
    const batch = await start(3);
    await imports.addRows(admin, batch.id, {
      rows: rows([
        { lastName: 'Annule', firstName: 'Un', phones: ['0611111111'] },
        { lastName: 'Annule', firstName: 'Deux', phones: [] },
        { lastName: 'Annule', firstName: 'Trois', phones: [] },
      ]),
    });
    await imports.commit(admin, batch.id, META);
    const created = await withTenant(t.appDb, clinic.id, (tx) =>
      tx.select().from(patients).where(eq(patients.importBatchId, batch.id)),
    );
    const modified = created.find((p) => p.firstName === 'Deux')!;
    await patientsService.update(
      admin,
      modified.id,
      { version: modified.version, email: 'deux@exemple.fr' },
      META,
    );
    const withContact = created.find((p) => p.firstName === 'Trois')!;
    await patientsService.addContact(admin, withContact.id, { phone: '0622222222' }, META);

    const result = await imports.revert(admin, batch.id, META);
    expect(result).toMatchObject({
      deleted: 1,
      kept: 2,
      summary: { status: 'REVERTED', counts: { reverted: 1 } },
    });
    const remaining = await withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select({ firstName: patients.firstName })
        .from(patients)
        .where(eq(patients.importBatchId, batch.id)),
    );
    expect(remaining.map((p) => p.firstName).sort()).toEqual(['Deux', 'Trois']);
    await expect(imports.revert(admin, batch.id, META)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(imports.commit(admin, batch.id, META)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it("l'annulation ne supprime jamais un patient ayant des notes médicales, même en version 1", async () => {
    // Filet de sécurité indépendant du verrou de version : une note écrite par un futur
    // chemin qui n'incrémenterait pas la version ne doit ni être perdue ni bloquer l'annulation.
    const batch = await start(2);
    await imports.addRows(admin, batch.id, {
      rows: rows([
        { lastName: 'Notee', firstName: 'Avec' },
        { lastName: 'Notee', firstName: 'Sans' },
      ]),
    });
    await imports.commit(admin, batch.id, META);
    const [target] = await withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select()
        .from(patients)
        .where(and(eq(patients.importBatchId, batch.id), eq(patients.firstName, 'Avec'))),
    );
    await withTenant(t.ownerDb, clinic.id, (tx) =>
      tx.insert(patientMedicalNotes).values({
        id: randomUUID(),
        patientId: target!.id,
        authorUserId: admin.userId,
        contentEnc: 'chiffré',
      }),
    );
    expect(target!.version).toBe(1);

    const result = await imports.revert(admin, batch.id, META);
    expect(result).toMatchObject({ deleted: 1, kept: 1 });
  });

  it('abandon d’un brouillon : lignes supprimées', async () => {
    const batch = await start(1);
    await imports.addRows(admin, batch.id, {
      rows: rows([{ lastName: 'Abandon', firstName: 'X', phones: [] }]),
    });
    expect((await imports.discard(admin, batch.id, META)).status).toBe('DISCARDED');
    const left = await withTenant(t.appDb, clinic.id, (tx) =>
      tx.select().from(importRows).where(eq(importRows.batchId, batch.id)),
    );
    expect(left).toEqual([]);
  });

  it('les brouillons abandonnés depuis plus de 24 h sont effacés au prochain import', async () => {
    const old = await start(1);
    await imports.addRows(admin, old.id, {
      rows: rows([{ lastName: 'Oublie', firstName: 'Y', phones: [] }]),
    });
    clock.advanceMinutes(25 * 60);
    await start(1);
    expect((await imports.get(admin, old.id)).status).toBe('DISCARDED');
    const left = await withTenant(t.appDb, clinic.id, (tx) =>
      tx.select().from(importRows).where(eq(importRows.batchId, old.id)),
    );
    expect(left).toEqual([]);
  });

  it.each(['DENTIST', 'SECRETARY'] as const)(
    "%s ne peut effectuer aucune opération d'import",
    async (role) => {
      const actor = actorFor((await createUser(t.ownerDb, clinic.id, role)).id, role, clinic.id);
      const batch = await start(1);
      const forbidden = { code: 'FORBIDDEN' };
      await expect(
        imports.create(
          actor,
          { kind: 'PATIENTS', fileName: 'x.csv', totalRows: 1, dateFormat: 'DD/MM/YYYY' },
          META,
        ),
      ).rejects.toMatchObject(forbidden);
      await expect(
        imports.addRows(actor, batch.id, {
          rows: rows([{ lastName: 'A', firstName: 'B', phones: [] }]),
        }),
      ).rejects.toMatchObject(forbidden);
      await expect(imports.list(actor)).rejects.toMatchObject(forbidden);
      await expect(imports.report(actor, batch.id, {})).rejects.toMatchObject(forbidden);
      await expect(imports.commit(actor, batch.id, META)).rejects.toMatchObject(forbidden);
      await expect(imports.revert(actor, batch.id, META)).rejects.toMatchObject(forbidden);
      await expect(imports.discard(actor, batch.id, META)).rejects.toMatchObject(forbidden);
    },
  );

  it("un import d'un autre cabinet est introuvable", async () => {
    const other = await createTestClinic(t.ownerDb);
    const otherAdmin = actorFor(
      (await createUser(t.ownerDb, other.id, 'ADMIN')).id,
      'ADMIN',
      other.id,
    );
    const theirs = await imports.create(
      otherAdmin,
      { kind: 'PATIENTS', fileName: 'x.csv', totalRows: 1, dateFormat: 'DD/MM/YYYY' },
      META,
    );
    await expect(imports.get(admin, theirs.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(imports.commit(admin, theirs.id, META)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('volume : 2 000 lignes en 4 paquets, validées en quelques secondes', async () => {
    const total = 2000;
    const batch = await start(total);
    const all = Array.from({ length: total }, (_, i) => ({
      line: i + 2,
      lastName: `Volume${i}`,
      firstName: 'Test',
      birthDate: `01/01/${1950 + (i % 60)}`,
      phones: [`06${String(10_000_000 + i).padStart(8, '0')}`],
    }));
    const t0 = Date.now();
    for (let i = 0; i < total; i += 500) {
      await imports.addRows(admin, batch.id, { rows: all.slice(i, i + 500) });
    }
    const committed = await imports.commit(admin, batch.id, META);
    const elapsed = Date.now() - t0;
    expect(committed.counts.created).toBe(total);
    expect(elapsed).toBeLessThan(20_000);
  });
});
