import { z } from 'zod';

/**
 * Import de données depuis des fichiers tabulaires (CSV, Excel). Le fichier est lu dans le
 * navigateur ; le serveur reçoit des lignes de texte brut, qu'il valide et normalise lui-même.
 */
export const IMPORT_LIMITS = {
  maxRows: 20_000,
  chunkSize: 500,
  maxFileBytes: 10 * 1024 * 1024,
  maxColumns: 100,
  maxPhones: 3,
} as const;

export const IMPORT_KINDS = ['PATIENTS'] as const;
export const importKindSchema = z.enum(IMPORT_KINDS);

export const IMPORT_STATUSES = ['DRAFT', 'COMMITTED', 'REVERTED', 'DISCARDED'] as const;
export const importStatusSchema = z.enum(IMPORT_STATUSES);

export const DATE_FORMATS = ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'] as const;
export const dateFormatSchema = z.enum(DATE_FORMATS);
export type DateFormat = z.infer<typeof dateFormatSchema>;

/** Champs de destination proposés pour l'association des colonnes. */
export const PATIENT_IMPORT_FIELDS = [
  'lastName',
  'firstName',
  'birthDate',
  'phone1',
  'phone2',
  'phone3',
  'email',
  'externalRef',
  'administrativeNote',
] as const;
export type PatientImportField = (typeof PATIENT_IMPORT_FIELDS)[number];

export const createImportRequestSchema = z.object({
  kind: importKindSchema,
  fileName: z.string().trim().min(1).max(255),
  totalRows: z.number().int().min(1).max(IMPORT_LIMITS.maxRows),
  dateFormat: dateFormatSchema,
});
export type CreateImportRequest = z.infer<typeof createImportRequestSchema>;

const raw = (max: number) => z.string().max(max).optional();

export const importRowInputSchema = z.object({
  line: z
    .number()
    .int()
    .min(1)
    .max(IMPORT_LIMITS.maxRows + 1),
  lastName: raw(500),
  firstName: raw(500),
  birthDate: raw(50),
  phones: z.array(z.string().max(50)).max(IMPORT_LIMITS.maxPhones).default([]),
  email: raw(500),
  externalRef: raw(200),
  administrativeNote: raw(5000),
});
export type ImportRowInput = z.input<typeof importRowInputSchema>;

export const addImportRowsRequestSchema = z.object({
  rows: z.array(importRowInputSchema).min(1).max(IMPORT_LIMITS.chunkSize),
});

export const IMPORT_ROW_STATUSES = ['VALID', 'INVALID', 'DUPLICATE_IN_FILE', 'EXISTING'] as const;
export const importRowStatusSchema = z.enum(IMPORT_ROW_STATUSES);

export const IMPORT_ISSUE_CODES = [
  'REQUIRED',
  'TOO_LONG',
  'INVALID_DATE',
  'DATE_OUT_OF_RANGE',
  'INVALID_PHONE',
  'INVALID_EMAIL',
  'DUPLICATE_IN_FILE',
  'EXISTING_PATIENT',
  'POSSIBLE_DUPLICATE',
  'DUPLICATE_LINE',
] as const;
export const importIssueSchema = z.object({
  field: z.string().nullable(),
  code: z.enum(IMPORT_ISSUE_CODES),
  severity: z.enum(['error', 'warning']),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const importCountsSchema = z.object({
  received: z.number().int(),
  valid: z.number().int(),
  invalid: z.number().int(),
  duplicateInFile: z.number().int(),
  existing: z.number().int(),
  withWarnings: z.number().int(),
  created: z.number().int(),
  reverted: z.number().int(),
});
export type ImportCounts = z.infer<typeof importCountsSchema>;

export const importSummarySchema = z.object({
  id: z.uuid(),
  kind: importKindSchema,
  status: importStatusSchema,
  fileName: z.string(),
  dateFormat: dateFormatSchema,
  totalRows: z.number().int(),
  counts: importCountsSchema,
  createdAt: z.string(),
  committedAt: z.string().nullable(),
  revertedAt: z.string().nullable(),
});
export type ImportSummary = z.infer<typeof importSummarySchema>;

export const listImportsResponseSchema = z.object({ imports: z.array(importSummarySchema) });

export const importRowReportSchema = z.object({
  line: z.number().int(),
  status: importRowStatusSchema,
  issues: z.array(importIssueSchema),
});
export const importRowsReportResponseSchema = z.object({
  rows: z.array(importRowReportSchema),
  total: z.number().int(),
});
export const importRowsReportQuerySchema = z.object({
  onlyIssues: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const revertImportResponseSchema = z.object({
  summary: importSummarySchema,
  deleted: z.number().int(),
  kept: z.number().int(),
});
