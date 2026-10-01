import type { AuditAction } from '@dental/shared';
import type {
  Contact,
  ContactInput,
  CreatePatientRequest,
  ListPatientsQuery,
  MedicalNote,
  PatientDetail,
  PatientSummary,
  UpdateContactRequest,
  UpdatePatientRequest,
} from '@dental/shared';
import {
  contactInputSchema,
  createPatientRequestSchema,
  listPatientsQuerySchema,
  updatePatientRequestSchema,
} from '@dental/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Database, Transaction } from '../../db/client';
import { clinics, patientContacts, patientMedicalNotes, patients, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import type { SecretBox } from '../../lib/secret-box';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';
import { hasFutureScheduled } from '../appointments/queries';
import {
  cleanName,
  normalizeForSearch,
  normalizePhone,
  parseBirthDate,
  patientSearchText,
} from './normalize';

export type PatientsService = ReturnType<typeof createPatientsService>;

const notFound = () => new AppError('NOT_FOUND', 'Patient introuvable', 404);
const staleVersion = () =>
  new AppError(
    'CONFLICT',
    "La fiche a été modifiée par quelqu'un d'autre entre-temps. Rechargez-la.",
    409,
  );
export const noteContext = (noteId: string) => `patient_medical_notes:${noteId}`;

// Résumé d'une fiche, à lire avec la jointure `primaryContact`. Jointure plutôt que sous-requête :
// dans une requête sur une seule table, Drizzle écrit les colonnes sans préfixe de table, et une
// référence à patients.id dans une sous-requête y désignerait la colonne id du contact.
const summaryColumns = {
  id: patients.id,
  lastName: patients.lastName,
  firstName: patients.firstName,
  birthDate: patients.birthDate,
  status: patients.status,
  primaryPhone: patientContacts.phoneE164,
};
// Au plus un contact principal par patient (index unique partiel) : pas de ligne dupliquée.
const primaryContact = and(
  eq(patientContacts.clinicId, patients.clinicId),
  eq(patientContacts.patientId, patients.id),
  eq(patientContacts.isPrimary, true),
);

function toContact(row: typeof patientContacts.$inferSelect): Contact {
  return {
    id: row.id,
    phone: row.phoneE164,
    relationship: row.relationship,
    label: row.label,
    isPrimary: row.isPrimary,
  };
}

export function createPatientsService(deps: {
  db: Database;
  secretBox: SecretBox;
  now?: () => Date;
}) {
  const { db, secretBox } = deps;
  const now = deps.now ?? (() => new Date());

  function audit(
    tx: Transaction,
    actor: UserActor,
    action: AuditAction,
    patientId: string,
    meta: RequestMeta,
    fields?: string[],
  ) {
    return recordAudit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      action,
      entityType: 'patient',
      entityId: patientId,
      // Noms des champs modifiés uniquement : l'audit ne recopie pas les données du patient.
      changes: fields && fields.length > 0 ? Object.fromEntries(fields.map((f) => [f, {}])) : null,
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  async function clinicCountry(tx: Transaction, clinicId: string): Promise<string> {
    const [clinic] = await tx
      .select({ country: clinics.countryCode })
      .from(clinics)
      .where(eq(clinics.id, clinicId));
    if (!clinic) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
    return clinic.country;
  }

  function phoneOrThrow(raw: string, country: string): string {
    const phone = normalizePhone(raw, country);
    if (!phone)
      throw new AppError('VALIDATION_FAILED', `Numéro de téléphone invalide : ${raw}`, 400);
    return phone;
  }

  function birthDateOrThrow(value: string | null | undefined): string | null | undefined {
    if (value === undefined || value === null) return value;
    const parsed = parseBirthDate(value, 'YYYY-MM-DD', now());
    if (!parsed.ok)
      throw new AppError('VALIDATION_FAILED', 'Date de naissance invalide ou future', 400);
    return parsed.value;
  }

  async function findPatient(tx: Transaction, clinicId: string, id: string) {
    const [row] = await tx
      .select()
      .from(patients)
      .where(and(eq(patients.clinicId, clinicId), eq(patients.id, id)));
    return row;
  }

  /** Toute modification liée à un patient incrémente sa version (verrou optimiste, annulation d'import). */
  async function touch(tx: Transaction, clinicId: string, id: string) {
    await tx
      .update(patients)
      .set({ version: sql`${patients.version} + 1` })
      .where(and(eq(patients.clinicId, clinicId), eq(patients.id, id)));
  }

  async function detail(tx: Transaction, clinicId: string, id: string): Promise<PatientDetail> {
    const patient = await findPatient(tx, clinicId, id);
    if (!patient) throw notFound();
    const contacts = await tx
      .select()
      .from(patientContacts)
      .where(and(eq(patientContacts.clinicId, clinicId), eq(patientContacts.patientId, id)))
      .orderBy(desc(patientContacts.isPrimary), asc(patientContacts.createdAt));
    const primary = contacts.find((c) => c.isPrimary);
    return {
      id: patient.id,
      lastName: patient.lastName,
      firstName: patient.firstName,
      birthDate: patient.birthDate,
      primaryPhone: primary?.phoneE164 ?? null,
      status: patient.status,
      email: patient.email,
      administrativeNote: patient.administrativeNote,
      createdSource: patient.createdSource,
      externalRef: patient.externalRef,
      version: patient.version,
      contacts: contacts.map(toContact),
      createdAt: patient.createdAt.toISOString(),
      updatedAt: patient.updatedAt.toISOString(),
    };
  }

  async function list(
    actor: UserActor,
    query: ListPatientsQuery,
  ): Promise<{ patients: PatientSummary[]; total: number }> {
    authorize(actor, 'patient.read');
    const q = listPatientsQuerySchema.parse(query);
    const conditions: SQL[] = [
      eq(patients.clinicId, actor.clinicId),
      eq(patients.status, q.status),
    ];
    if (q.q) {
      const alternatives: SQL[] = [];
      const text = normalizeForSearch(q.q);
      if (text) alternatives.push(ilike(patients.searchText, `%${text.replace(/[%_]/g, '')}%`));
      const digits = q.q.replace(/\D/g, '');
      if (digits.length >= 4) {
        const national = digits.replace(/^0+/, '');
        alternatives.push(
          exists(
            db
              .select({ one: sql`1` })
              .from(patientContacts)
              .where(
                and(
                  eq(patientContacts.patientId, patients.id),
                  sql`${patientContacts.phoneE164} LIKE ${`%${national}%`}`,
                ),
              ),
          ),
        );
      }
      const date = parseBirthDate(q.q, 'DD/MM/YYYY', now());
      if (date.ok) alternatives.push(eq(patients.birthDate, date.value));
      if (alternatives.length === 0) return { patients: [], total: 0 };
      conditions.push(or(...alternatives) ?? sql`false`);
    }
    return withTenant(db, actor.clinicId, async (tx) => {
      const where = and(...conditions);
      const [total] = await tx.select({ n: count() }).from(patients).where(where);
      const rows = await tx
        .select(summaryColumns)
        .from(patients)
        .leftJoin(patientContacts, primaryContact)
        .where(where)
        .orderBy(asc(patients.lastName), asc(patients.firstName), asc(patients.id))
        .limit(q.limit)
        .offset(q.offset);
      return { patients: rows, total: total?.n ?? 0 };
    });
  }

  /** Patients actifs de même nom et prénom, avec la même date de naissance ou sans date. */
  async function duplicates(
    actor: UserActor,
    input: { lastName: string; firstName: string; birthDate?: string | undefined },
  ): Promise<PatientSummary[]> {
    authorize(actor, 'patient.read');
    const searchText = patientSearchText(input.lastName, input.firstName);
    return withTenant(db, actor.clinicId, (tx) =>
      tx
        .select(summaryColumns)
        .from(patients)
        .leftJoin(patientContacts, primaryContact)
        .where(
          and(
            eq(patients.clinicId, actor.clinicId),
            eq(patients.status, 'ACTIVE'),
            eq(patients.searchText, searchText),
            input.birthDate
              ? or(eq(patients.birthDate, input.birthDate), isNull(patients.birthDate))
              : undefined,
          ),
        )
        .limit(10),
    );
  }

  async function get(actor: UserActor, id: string): Promise<PatientDetail> {
    authorize(actor, 'patient.read');
    return withTenant(db, actor.clinicId, (tx) => detail(tx, actor.clinicId, id));
  }

  async function insertContacts(
    tx: Transaction,
    clinicId: string,
    patientId: string,
    contacts: ContactInput[],
    country: string,
  ) {
    const parsed = contacts.map((c) => contactInputSchema.parse(c));
    const phones = parsed.map((c) => phoneOrThrow(c.phone, country));
    if (new Set(phones).size !== phones.length) {
      throw new AppError('VALIDATION_FAILED', 'Le même numéro apparaît deux fois', 400);
    }
    const primaryIndex = Math.max(
      0,
      parsed.findIndex((c) => c.isPrimary),
    );
    if (parsed.length === 0) return;
    await tx.insert(patientContacts).values(
      parsed.map((c, i) => ({
        clinicId,
        patientId,
        phoneE164: phones[i] ?? '',
        relationship: c.relationship,
        label: c.label ?? null,
        isPrimary: i === primaryIndex,
      })),
    );
  }

  async function create(
    actor: UserActor,
    input: CreatePatientRequest,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    authorize(actor, 'patient.write');
    const data = createPatientRequestSchema.parse(input);
    const birthDate = birthDateOrThrow(data.birthDate) ?? null;
    const lastName = cleanName(data.lastName);
    const firstName = cleanName(data.firstName);
    return withTenant(db, actor.clinicId, async (tx) => {
      const country = await clinicCountry(tx, actor.clinicId);
      const id = uuidv7();
      await tx.insert(patients).values({
        id,
        clinicId: actor.clinicId,
        lastName,
        firstName,
        birthDate,
        email: data.email ?? null,
        administrativeNote: data.administrativeNote ?? null,
        createdSource: 'STAFF',
        searchText: patientSearchText(lastName, firstName),
        createdBy: actor.userId,
      });
      await insertContacts(tx, actor.clinicId, id, data.contacts, country);
      await audit(tx, actor, 'patient.created', id, meta);
      return detail(tx, actor.clinicId, id);
    });
  }

  async function update(
    actor: UserActor,
    id: string,
    input: UpdatePatientRequest,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    authorize(actor, 'patient.write');
    const data = updatePatientRequestSchema.parse(input);
    const birthDate = birthDateOrThrow(data.birthDate);
    return withTenant(db, actor.clinicId, async (tx) => {
      const current = await findPatient(tx, actor.clinicId, id);
      if (!current) throw notFound();
      const lastName = data.lastName !== undefined ? cleanName(data.lastName) : current.lastName;
      const firstName =
        data.firstName !== undefined ? cleanName(data.firstName) : current.firstName;
      const patch = {
        lastName,
        firstName,
        searchText: patientSearchText(lastName, firstName),
        ...(birthDate !== undefined ? { birthDate } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.administrativeNote !== undefined
          ? { administrativeNote: data.administrativeNote }
          : {}),
      };
      const updated = await tx
        .update(patients)
        .set({ ...patch, version: sql`${patients.version} + 1` })
        .where(
          and(
            eq(patients.clinicId, actor.clinicId),
            eq(patients.id, id),
            eq(patients.version, data.version),
          ),
        )
        .returning({ id: patients.id });
      if (updated.length === 0) throw staleVersion();
      const fields = (
        ['lastName', 'firstName', 'birthDate', 'email', 'administrativeNote'] as const
      ).filter((f) => data[f] !== undefined && data[f] !== current[f]);
      await audit(tx, actor, 'patient.updated', id, meta, [...fields]);
      return detail(tx, actor.clinicId, id);
    });
  }

  async function setStatus(
    actor: UserActor,
    id: string,
    version: number,
    status: 'ACTIVE' | 'ARCHIVED',
    meta: RequestMeta,
  ) {
    authorize(actor, 'patient.write');
    return withTenant(db, actor.clinicId, async (tx) => {
      if (
        status === 'ARCHIVED' &&
        (await hasFutureScheduled(tx, actor.clinicId, { patientId: id }, now()))
      ) {
        throw new AppError(
          'CONFLICT',
          'Ce patient a des rendez-vous prévus à venir : annulez-les avant d’archiver sa fiche',
          409,
        );
      }
      const updated = await tx
        .update(patients)
        .set({
          status,
          archivedAt: status === 'ARCHIVED' ? now() : null,
          version: sql`${patients.version} + 1`,
        })
        .where(
          and(
            eq(patients.clinicId, actor.clinicId),
            eq(patients.id, id),
            eq(patients.version, version),
          ),
        )
        .returning({ id: patients.id });
      if (updated.length === 0) {
        if (!(await findPatient(tx, actor.clinicId, id))) throw notFound();
        throw staleVersion();
      }
      await audit(
        tx,
        actor,
        status === 'ARCHIVED' ? 'patient.archived' : 'patient.restored',
        id,
        meta,
      );
      return detail(tx, actor.clinicId, id);
    });
  }

  async function addContact(
    actor: UserActor,
    patientId: string,
    input: ContactInput,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    authorize(actor, 'patient.write');
    const data = contactInputSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      if (!(await findPatient(tx, actor.clinicId, patientId))) throw notFound();
      const phone = phoneOrThrow(data.phone, await clinicCountry(tx, actor.clinicId));
      const existing = await tx
        .select({ id: patientContacts.id, phone: patientContacts.phoneE164 })
        .from(patientContacts)
        .where(
          and(
            eq(patientContacts.clinicId, actor.clinicId),
            eq(patientContacts.patientId, patientId),
          ),
        );
      if (existing.some((c) => c.phone === phone)) {
        throw new AppError('CONFLICT', 'Ce numéro est déjà enregistré pour ce patient', 409);
      }
      const primary = data.isPrimary === true || existing.length === 0;
      if (primary) {
        await tx
          .update(patientContacts)
          .set({ isPrimary: false })
          .where(
            and(
              eq(patientContacts.clinicId, actor.clinicId),
              eq(patientContacts.patientId, patientId),
            ),
          );
      }
      await tx.insert(patientContacts).values({
        clinicId: actor.clinicId,
        patientId,
        phoneE164: phone,
        relationship: data.relationship,
        label: data.label ?? null,
        isPrimary: primary,
      });
      await touch(tx, actor.clinicId, patientId);
      await audit(tx, actor, 'patient.contact_added', patientId, meta);
      return detail(tx, actor.clinicId, patientId);
    });
  }

  async function updateContact(
    actor: UserActor,
    patientId: string,
    contactId: string,
    input: UpdateContactRequest,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    authorize(actor, 'patient.write');
    return withTenant(db, actor.clinicId, async (tx) => {
      const scope = and(
        eq(patientContacts.clinicId, actor.clinicId),
        eq(patientContacts.patientId, patientId),
      );
      const [contact] = await tx
        .select()
        .from(patientContacts)
        .where(and(scope, eq(patientContacts.id, contactId)));
      if (!contact) throw new AppError('NOT_FOUND', 'Contact introuvable', 404);
      if (input.isPrimary) {
        await tx
          .update(patientContacts)
          .set({ isPrimary: false })
          .where(and(scope, ne(patientContacts.id, contactId)));
      }
      await tx
        .update(patientContacts)
        .set({
          ...(input.relationship !== undefined ? { relationship: input.relationship } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.isPrimary ? { isPrimary: true } : {}),
        })
        .where(and(scope, eq(patientContacts.id, contactId)));
      await touch(tx, actor.clinicId, patientId);
      await audit(tx, actor, 'patient.contact_updated', patientId, meta);
      return detail(tx, actor.clinicId, patientId);
    });
  }

  async function removeContact(
    actor: UserActor,
    patientId: string,
    contactId: string,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    authorize(actor, 'patient.write');
    return withTenant(db, actor.clinicId, async (tx) => {
      const scope = and(
        eq(patientContacts.clinicId, actor.clinicId),
        eq(patientContacts.patientId, patientId),
      );
      const [removed] = await tx
        .delete(patientContacts)
        .where(and(scope, eq(patientContacts.id, contactId)))
        .returning({ isPrimary: patientContacts.isPrimary });
      if (!removed) throw new AppError('NOT_FOUND', 'Contact introuvable', 404);
      if (removed.isPrimary) {
        // Le plus ancien contact restant devient le contact principal.
        const [next] = await tx
          .select({ id: patientContacts.id })
          .from(patientContacts)
          .where(scope)
          .orderBy(asc(patientContacts.createdAt))
          .limit(1);
        if (next)
          await tx
            .update(patientContacts)
            .set({ isPrimary: true })
            .where(eq(patientContacts.id, next.id));
      }
      await touch(tx, actor.clinicId, patientId);
      await audit(tx, actor, 'patient.contact_removed', patientId, meta);
      return detail(tx, actor.clinicId, patientId);
    });
  }

  async function listMedicalNotes(
    actor: UserActor,
    patientId: string,
    meta: RequestMeta,
  ): Promise<MedicalNote[]> {
    authorize(actor, 'patient.medical.read');
    return withTenant(db, actor.clinicId, async (tx) => {
      if (!(await findPatient(tx, actor.clinicId, patientId))) throw notFound();
      const rows = await tx
        .select({ note: patientMedicalNotes, authorName: users.fullName })
        .from(patientMedicalNotes)
        .leftJoin(users, eq(users.id, patientMedicalNotes.authorUserId))
        .where(
          and(
            eq(patientMedicalNotes.clinicId, actor.clinicId),
            eq(patientMedicalNotes.patientId, patientId),
          ),
        )
        .orderBy(desc(patientMedicalNotes.createdAt));
      // Toute consultation de données médicales est tracée.
      await audit(tx, actor, 'patient.medical_notes_read', patientId, meta);
      return rows.map(({ note, authorName }) => ({
        id: note.id,
        content: secretBox.decrypt(note.contentEnc, noteContext(note.id)),
        authorName: authorName ?? 'Compte supprimé',
        createdAt: note.createdAt.toISOString(),
      }));
    });
  }

  async function addMedicalNote(
    actor: UserActor,
    patientId: string,
    content: string,
    meta: RequestMeta,
  ): Promise<void> {
    authorize(actor, 'patient.medical.write');
    const text = content.trim();
    if (text.length === 0 || text.length > 5000) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Note vide ou trop longue (5000 caractères maximum)',
        400,
      );
    }
    await withTenant(db, actor.clinicId, async (tx) => {
      if (!(await findPatient(tx, actor.clinicId, patientId))) throw notFound();
      const id = uuidv7();
      await tx.insert(patientMedicalNotes).values({
        id,
        clinicId: actor.clinicId,
        patientId,
        authorUserId: actor.userId,
        contentEnc: secretBox.encrypt(text, noteContext(id)),
      });
      await touch(tx, actor.clinicId, patientId);
      await audit(tx, actor, 'patient.medical_note_added', patientId, meta);
    });
  }

  return {
    list,
    duplicates,
    get,
    create,
    update,
    archive: (actor: UserActor, id: string, version: number, meta: RequestMeta) =>
      setStatus(actor, id, version, 'ARCHIVED', meta),
    restore: (actor: UserActor, id: string, version: number, meta: RequestMeta) =>
      setStatus(actor, id, version, 'ACTIVE', meta),
    addContact,
    updateContact,
    removeContact,
    listMedicalNotes,
    addMedicalNote,
  };
}
