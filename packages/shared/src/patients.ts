import { z } from 'zod';

export const RELATIONSHIPS = ['SELF', 'GUARDIAN', 'OTHER'] as const;
export const relationshipSchema = z.enum(RELATIONSHIPS);
export type Relationship = z.infer<typeof relationshipSchema>;

export const PATIENT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export const patientStatusSchema = z.enum(PATIENT_STATUSES);

export const PATIENT_SOURCES = ['STAFF', 'IMPORT'] as const;

const name = z.string().trim().min(1, 'Obligatoire').max(100);
const isoDate = z.iso.date();

export const contactInputSchema = z.object({
  phone: z.string().trim().min(3).max(32),
  relationship: relationshipSchema.default('SELF'),
  label: z.string().trim().max(60).nullable().optional(),
  isPrimary: z.boolean().optional(),
});
export type ContactInput = z.input<typeof contactInputSchema>;

const patientFields = {
  lastName: name,
  firstName: name,
  birthDate: isoDate.nullable().optional(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).nullable().optional(),
  administrativeNote: z.string().trim().max(1000).nullable().optional(),
};

export const createPatientRequestSchema = z.object({
  ...patientFields,
  contacts: z.array(contactInputSchema).max(5).default([]),
});
export type CreatePatientRequest = z.input<typeof createPatientRequestSchema>;

export const updatePatientRequestSchema = z
  .object({
    lastName: patientFields.lastName.optional(),
    firstName: patientFields.firstName.optional(),
    birthDate: patientFields.birthDate,
    email: patientFields.email,
    administrativeNote: patientFields.administrativeNote,
    // Verrou optimiste : la modification est refusée si la fiche a changé entre-temps.
    version: z.number().int().positive(),
  })
  .refine(
    (v) => Object.entries(v).some(([k, x]) => k !== 'version' && x !== undefined),
    'Aucune modification demandée',
  );
export type UpdatePatientRequest = z.input<typeof updatePatientRequestSchema>;

export const versionRequestSchema = z.object({ version: z.number().int().positive() });

export const updateContactRequestSchema = z
  .object({
    relationship: relationshipSchema.optional(),
    label: z.string().trim().max(60).nullable().optional(),
    isPrimary: z.literal(true).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Aucune modification demandée');
export type UpdateContactRequest = z.input<typeof updateContactRequestSchema>;

export const contactSchema = z.object({
  id: z.uuid(),
  phone: z.string(),
  relationship: relationshipSchema,
  label: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type Contact = z.infer<typeof contactSchema>;

export const patientSummarySchema = z.object({
  id: z.uuid(),
  lastName: z.string(),
  firstName: z.string(),
  birthDate: z.string().nullable(),
  primaryPhone: z.string().nullable(),
  status: patientStatusSchema,
});
export type PatientSummary = z.infer<typeof patientSummarySchema>;

export const patientDetailSchema = patientSummarySchema.extend({
  email: z.string().nullable(),
  administrativeNote: z.string().nullable(),
  createdSource: z.enum(PATIENT_SOURCES),
  externalRef: z.string().nullable(),
  version: z.number().int(),
  contacts: z.array(contactSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PatientDetail = z.infer<typeof patientDetailSchema>;

/**
 * Recherche et détection de doublons : le texte saisi (nom, téléphone, date de naissance) part
 * dans le corps d'une requête POST, jamais dans l'adresse, que les proxys et hébergeurs
 * journalisent (écart E19).
 */
export const searchPatientsRequestSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: patientStatusSchema.default('ACTIVE'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type SearchPatientsRequest = z.input<typeof searchPatientsRequestSchema>;

export const listPatientsResponseSchema = z.object({
  patients: z.array(patientSummarySchema),
  total: z.number().int(),
});

export const duplicateCheckRequestSchema = z.object({
  lastName: name,
  firstName: name,
  birthDate: isoDate.optional(),
});
export type DuplicateCheckRequest = z.input<typeof duplicateCheckRequestSchema>;
export const duplicateCandidatesResponseSchema = z.object({
  candidates: z.array(patientSummarySchema),
});

export const medicalNoteSchema = z.object({
  id: z.uuid(),
  content: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
});
export type MedicalNote = z.infer<typeof medicalNoteSchema>;
export const listMedicalNotesResponseSchema = z.object({ notes: z.array(medicalNoteSchema) });
export const createMedicalNoteRequestSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});
