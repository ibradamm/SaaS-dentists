import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFor } from '../../../../test/actors';
import { META, createUser } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import { auditLogs, patientMedicalNotes, patients, type Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import { createSecretBox } from '../../../lib/secret-box';
import type { UserActor } from '../../auth/auth.types';
import { createPatientsService } from '../patients.service';

describe('dossier patient', () => {
  const t = openTestDatabase();
  const service = createPatientsService({
    db: t.appDb,
    secretBox: createSecretBox(randomBytes(32)),
  });
  let clinic: Clinic;
  let other: Clinic;
  let secretary: UserActor;
  let dentist: UserActor;

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
    other = await createTestClinic(t.ownerDb);
    secretary = actorFor(
      (await createUser(t.ownerDb, clinic.id, 'SECRETARY')).id,
      'SECRETARY',
      clinic.id,
    );
    dentist = actorFor(
      (await createUser(t.ownerDb, clinic.id, 'DENTIST')).id,
      'DENTIST',
      clinic.id,
    );
  });
  afterAll(() => t.close());

  const newPatient = (overrides: Record<string, unknown> = {}) =>
    service.create(
      secretary,
      {
        lastName: 'Lefèvre',
        firstName: 'Hélène',
        birthDate: '1980-05-17',
        contacts: [
          { phone: '06 12 34 56 78' },
          { phone: '01 45 67 89 10', relationship: 'OTHER', label: 'Travail' },
        ],
        ...overrides,
      },
      META,
    );

  it('crée une fiche avec contacts normalisés et un contact principal', async () => {
    const p = await newPatient();
    expect(p).toMatchObject({
      lastName: 'Lefèvre',
      firstName: 'Hélène',
      birthDate: '1980-05-17',
      createdSource: 'STAFF',
      version: 1,
      primaryPhone: '+33612345678',
    });
    expect(p.contacts.map((c) => [c.phone, c.isPrimary])).toEqual([
      ['+33612345678', true],
      ['+33145678910', false],
    ]);
  });

  it('refuse un numéro invalide ou une date de naissance future', async () => {
    await expect(newPatient({ contacts: [{ phone: '123' }] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(newPatient({ birthDate: '2999-01-01' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('recherche sans accents, par téléphone local et par date de naissance', async () => {
    const p = await newPatient({
      lastName: 'Zéphyrin',
      firstName: 'Anaïs',
      contacts: [{ phone: '0698765432' }],
      birthDate: '1975-12-24',
    });
    const ids = async (q: string) =>
      (await service.list(secretary, { q })).patients.map((x) => x.id);
    expect(await ids('zephyrin anais')).toContain(p.id);
    expect(await ids('ZÉPHY')).toContain(p.id);
    expect(await ids('06 98 76')).toContain(p.id);
    expect(await ids('24/12/1975')).toContain(p.id);
    expect(await ids('inexistant-xyz')).toEqual([]);

    // Résumé : téléphone principal (une seule ligne par patient), null sans téléphone.
    const bare = await newPatient({ lastName: 'Zéphyrin', firstName: 'Basile', contacts: [] });
    await service.addContact(secretary, p.id, { phone: '01 45 67 89 10' }, META);
    const listed = (await service.list(secretary, { q: 'zephyrin' })).patients;
    expect(listed).toEqual([
      {
        id: p.id,
        lastName: 'Zéphyrin',
        firstName: 'Anaïs',
        birthDate: '1975-12-24',
        primaryPhone: '+33698765432',
        status: 'ACTIVE',
      },
      expect.objectContaining({ id: bare.id, primaryPhone: null }),
    ]);
  });

  it('verrou optimiste : une modification sur une version périmée est refusée', async () => {
    const p = await newPatient();
    const updated = await service.update(
      secretary,
      p.id,
      { version: 1, email: 'helene@exemple.fr' },
      META,
    );
    expect(updated.version).toBe(2);
    await expect(
      service.update(secretary, p.id, { version: 1, firstName: 'Autre' }, META),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it("l'audit trace les champs modifiés sans recopier leurs valeurs", async () => {
    const p = await newPatient();
    await service.update(secretary, p.id, { version: 1, lastName: 'Martin' }, META);
    const [entry] = await withTenant(t.appDb, clinic.id, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, p.id), eq(auditLogs.action, 'patient.updated'))),
    );
    expect(entry?.changes).toEqual({ lastName: {} });
    expect(JSON.stringify(entry)).not.toContain('Martin');
  });

  it('archivage et restauration ; la liste par défaut exclut les archivés', async () => {
    const p = await newPatient({ lastName: 'Archivable' });
    const archived = await service.archive(secretary, p.id, p.version, META);
    expect(archived.status).toBe('ARCHIVED');
    expect((await service.list(secretary, { q: 'archivable' })).patients).toEqual([]);
    expect((await service.list(secretary, { q: 'archivable', status: 'ARCHIVED' })).total).toBe(1);
    expect((await service.restore(secretary, p.id, archived.version, META)).status).toBe('ACTIVE');
  });

  it('contacts : doublon refusé, principal déplacé, version incrémentée, modifications auditées', async () => {
    const p = await newPatient();
    await expect(
      service.addContact(secretary, p.id, { phone: '+33612345678' }, META),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const second = p.contacts[1]!;
    const switched = await service.updateContact(
      secretary,
      p.id,
      second.id,
      { isPrimary: true },
      META,
    );
    expect(switched.primaryPhone).toBe('+33145678910');
    expect(switched.contacts.filter((c) => c.isPrimary)).toHaveLength(1);
    const removed = await service.removeContact(secretary, p.id, second.id, META);
    expect(removed.primaryPhone).toBe('+33612345678');
    expect(removed.version).toBe(p.version + 2);
    const actions = await withTenant(t.appDb, clinic.id, (tx) =>
      tx.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, p.id)),
    );
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'patient.created',
        'patient.contact_updated',
        'patient.contact_removed',
      ]),
    );
  });

  it('doublons possibles : même nom et même date, ou date inconnue', async () => {
    const p = await newPatient({ lastName: 'Doublon', firstName: 'Paul', birthDate: '1990-01-01' });
    const found = await service.duplicates(secretary, {
      lastName: 'DOUBLON',
      firstName: 'paul',
      birthDate: '1990-01-01',
    });
    expect(found.filter((x) => x.id === p.id)).toEqual([
      expect.objectContaining({ primaryPhone: '+33612345678' }),
    ]);
    const other = await service.duplicates(secretary, {
      lastName: 'Doublon',
      firstName: 'Paul',
      birthDate: '1991-01-01',
    });
    expect(other.map((x) => x.id)).not.toContain(p.id);
  });

  describe('notes médicales', () => {
    it('le dentiste écrit et lit ; le contenu est chiffré en base ; la lecture est auditée', async () => {
      const p = await newPatient();
      await service.addMedicalNote(dentist, p.id, 'Allergie à la pénicilline', META);
      const notes = await service.listMedicalNotes(dentist, p.id, META);
      expect(notes.map((n) => n.content)).toEqual(['Allergie à la pénicilline']);
      const [stored] = await withTenant(t.appDb, clinic.id, (tx) =>
        tx.select().from(patientMedicalNotes).where(eq(patientMedicalNotes.patientId, p.id)),
      );
      expect(stored?.contentEnc).not.toContain('pénicilline');
      const reads = await withTenant(t.appDb, clinic.id, (tx) =>
        tx
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.entityId, p.id), eq(auditLogs.action, 'patient.medical_notes_read')),
          ),
      );
      expect(reads).toHaveLength(1);
    });

    it('la secrétaire ne peut ni lire ni écrire de note médicale', async () => {
      const p = await newPatient();
      await expect(service.listMedicalNotes(secretary, p.id, META)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(service.addMedicalNote(secretary, p.id, 'x', META)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  it("un patient d'un autre cabinet est introuvable", async () => {
    const outsiderActor = actorFor(
      (await createUser(t.ownerDb, other.id, 'SECRETARY')).id,
      'SECRETARY',
      other.id,
    );
    const theirs = await service.create(
      outsiderActor,
      { lastName: 'Ailleurs', firstName: 'Zoé' },
      META,
    );
    await expect(service.get(secretary, theirs.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await service.list(secretary, { q: 'ailleurs' })).patients).toEqual([]);
  });

  it("le rôle applicatif ne peut pas supprimer un patient saisi à la main (seulement l'archiver)", async () => {
    const p = await newPatient();
    const result = await withTenant(t.appDb, clinic.id, (tx) =>
      tx.execute(sql`DELETE FROM patients WHERE id = ${p.id}`),
    );
    expect(result.rowCount).toBe(0);
    const [still] = await withTenant(t.appDb, clinic.id, (tx) =>
      tx.select({ id: patients.id }).from(patients).where(eq(patients.id, p.id)),
    );
    expect(still?.id).toBe(p.id);
  });
});
