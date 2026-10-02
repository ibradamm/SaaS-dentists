import { PATIENT_SOURCES, PATIENT_STATUSES, RELATIONSHIPS } from '@dental/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinicIdColumn, createdAt, primaryId, updatedAt } from './_columns';
import { clinics } from './clinics';
import { importBatches } from './imports';

/**
 * Dossier patient administratif (identité, coordonnées). Les notes médicales sont dans une
 * table séparée, à accès restreint ; les finances arriveront dans leur propre module.
 */
export const patients = pgTable(
  'patients',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    lastName: text('last_name').notNull(),
    firstName: text('first_name').notNull(),
    birthDate: date('birth_date', { mode: 'string' }),
    email: text('email'),
    administrativeNote: text('administrative_note'),
    status: text('status', { enum: PATIENT_STATUSES }).notNull().default('ACTIVE'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdSource: text('created_source', { enum: PATIENT_SOURCES }).notNull(),
    // Lot d'import d'origine : seuls ces patients peuvent être supprimés (annulation d'import).
    importBatchId: uuid('import_batch_id'),
    // Identifiant dans le logiciel d'origine (numéro de dossier), unique par cabinet.
    externalRef: text('external_ref'),
    // Nom et prénom normalisés (minuscules, sans accents) pour la recherche et les doublons.
    searchText: text('search_text').notNull(),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('patients_clinic_id_key').on(t.clinicId, t.id),
    uniqueIndex('patients_clinic_external_ref_key')
      .on(t.clinicId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    foreignKey({
      name: 'patients_import_batch_fk',
      columns: [t.clinicId, t.importBatchId],
      foreignColumns: [importBatches.clinicId, importBatches.id],
    }),
    index('patients_search_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    index('patients_clinic_identity_idx').on(t.clinicId, t.searchText, t.birthDate),
    index('patients_import_batch_idx').on(t.importBatchId),
    check('patients_last_name_length', sql`char_length(${t.lastName}) between 1 and 100`),
    check('patients_first_name_length', sql`char_length(${t.firstName}) between 1 and 100`),
    check('patients_email_format', sql`${t.email} is null or ${t.email} ~ '^[^@\\s]+@[^@\\s]+$'`),
    check('patients_note_length', sql`char_length(${t.administrativeNote}) <= 1000`),
    check('patients_status_values', sql`${t.status} in ('ACTIVE', 'ARCHIVED')`),
    check('patients_source_values', sql`${t.createdSource} in ('STAFF', 'IMPORT')`),
    check('patients_external_ref_length', sql`char_length(${t.externalRef}) <= 64`),
    check(
      'patients_birth_date_range',
      sql`${t.birthDate} is null or ${t.birthDate} >= date '1900-01-01'`,
    ),
  ],
);

export const patientContacts = pgTable(
  'patient_contacts',
  {
    id: primaryId(),
    clinicId: clinicIdColumn(),
    patientId: uuid('patient_id').notNull(),
    // Numéro normalisé au format international E.164 (+33612345678).
    phoneE164: text('phone_e164').notNull(),
    relationship: text('relationship', { enum: RELATIONSHIPS }).notNull().default('SELF'),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'patient_contacts_patient_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }).onDelete('cascade'),
    unique('patient_contacts_patient_phone_key').on(t.patientId, t.phoneE164),
    uniqueIndex('patient_contacts_one_primary_key')
      .on(t.patientId)
      .where(sql`${t.isPrimary}`),
    index('patient_contacts_clinic_phone_idx').on(t.clinicId, t.phoneE164),
    check('patient_contacts_phone_format', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check(
      'patient_contacts_relationship_values',
      sql`${t.relationship} in ('SELF', 'GUARDIAN', 'OTHER')`,
    ),
    check('patient_contacts_label_length', sql`char_length(${t.label}) <= 60`),
  ],
);

/**
 * Notes médicales : contenu chiffré (AES-256-GCM), ajout seul (une correction est une
 * nouvelle note), lecture réservée à patient.medical.read et tracée dans l'audit.
 */
export const patientMedicalNotes = pgTable(
  'patient_medical_notes',
  {
    id: primaryId(),
    clinicId: clinicIdColumn(),
    patientId: uuid('patient_id').notNull(),
    authorUserId: uuid('author_user_id').notNull(),
    contentEnc: text('content_enc').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'patient_medical_notes_patient_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }).onDelete('restrict'),
    index('patient_medical_notes_patient_idx').on(t.clinicId, t.patientId, t.createdAt.desc()),
  ],
);

export type Patient = typeof patients.$inferSelect;
export type PatientContact = typeof patientContacts.$inferSelect;
export type PatientMedicalNote = typeof patientMedicalNotes.$inferSelect;
