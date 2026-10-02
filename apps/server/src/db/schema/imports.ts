import {
  DATE_FORMATS,
  IMPORT_KINDS,
  IMPORT_ROW_STATUSES,
  IMPORT_STATUSES,
  type ImportCounts,
  type ImportIssue,
} from '@dental/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinicIdColumn, createdAt, primaryId, updatedAt } from './_columns';
import { clinics } from './clinics';

/** Lot d'import (un fichier). Voir docs/adr/0005-import-de-donnees.md. */
export const importBatches = pgTable(
  'import_batches',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    kind: text('kind', { enum: IMPORT_KINDS }).notNull(),
    status: text('status', { enum: IMPORT_STATUSES }).notNull().default('DRAFT'),
    fileName: text('file_name').notNull(),
    dateFormat: text('date_format', { enum: DATE_FORMATS }).notNull(),
    totalRows: integer('total_rows').notNull(),
    counts: jsonb('counts').$type<ImportCounts>().notNull(),
    createdBy: uuid('created_by').notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('import_batches_clinic_id_key').on(t.clinicId, t.id),
    index('import_batches_clinic_created_idx').on(t.clinicId, t.createdAt.desc()),
    check('import_batches_kind_values', sql`${t.kind} in ('PATIENTS')`),
    check(
      'import_batches_status_values',
      sql`${t.status} in ('DRAFT', 'COMMITTED', 'REVERTED', 'DISCARDED')`,
    ),
    check('import_batches_file_name_length', sql`char_length(${t.fileName}) between 1 and 255`),
    check('import_batches_total_rows_range', sql`${t.totalRows} between 1 and 20000`),
  ],
);

/**
 * Ligne d'un lot : données normalisées (effacées après validation ou abandon du lot) et
 * anomalies détectées. Les anomalies ne contiennent que des codes, jamais de valeurs.
 */
export const importRows = pgTable(
  'import_rows',
  {
    id: primaryId(),
    clinicId: clinicIdColumn(),
    batchId: uuid('batch_id').notNull(),
    line: integer('line').notNull(),
    status: text('status', { enum: IMPORT_ROW_STATUSES }).notNull(),
    dedupKey: text('dedup_key'),
    externalRef: text('external_ref'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    issues: jsonb('issues').$type<ImportIssue[]>().notNull().default([]),
    patientId: uuid('patient_id'),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'import_rows_batch_fk',
      columns: [t.clinicId, t.batchId],
      foreignColumns: [importBatches.clinicId, importBatches.id],
    }).onDelete('cascade'),
    unique('import_rows_batch_line_key').on(t.batchId, t.line),
    index('import_rows_batch_dedup_idx').on(t.batchId, t.dedupKey),
    index('import_rows_batch_ref_idx').on(t.batchId, t.externalRef),
    check(
      'import_rows_status_values',
      sql`${t.status} in ('VALID', 'INVALID', 'DUPLICATE_IN_FILE', 'EXISTING')`,
    ),
  ],
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
