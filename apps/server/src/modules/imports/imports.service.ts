import {
  addImportRowsRequestSchema,
  createImportRequestSchema,
  importRowsReportQuerySchema,
  type CreateImportRequest,
  type ImportCounts,
  type ImportIssue,
  type ImportRowInput,
  type ImportSummary,
} from '@dental/shared';
import { and, asc, desc, eq, inArray, isNotNull, lt, notExists, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Database, Transaction } from '../../db/client';
import {
  appointments,
  clinics,
  importBatches,
  importRows,
  patientContacts,
  patientMedicalNotes,
  patients,
  type ImportBatch,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';
import { patientSearchText } from '../patients/normalize';
import { validatePatientRow, type NormalizedPatientRow } from './patient-row';

export type ImportsService = ReturnType<typeof createImportsService>;

const EMPTY_COUNTS: ImportCounts = {
  received: 0,
  valid: 0,
  invalid: 0,
  duplicateInFile: 0,
  existing: 0,
  withWarnings: 0,
  created: 0,
  reverted: 0,
};
// Brouillons abandonnés : leurs données personnelles sont supprimées après ce délai.
const DRAFT_RETENTION_HOURS = 24;
const INSERT_CHUNK = 1000;

const notFound = () => new AppError('NOT_FOUND', 'Import introuvable', 404);

function toSummary(batch: ImportBatch): ImportSummary {
  return {
    id: batch.id,
    kind: batch.kind,
    status: batch.status,
    fileName: batch.fileName,
    dateFormat: batch.dateFormat,
    totalRows: batch.totalRows,
    counts: batch.counts,
    createdAt: batch.createdAt.toISOString(),
    committedAt: batch.committedAt?.toISOString() ?? null,
    revertedAt: batch.revertedAt?.toISOString() ?? null,
  };
}

interface Prepared {
  line: number;
  status: 'VALID' | 'INVALID' | 'DUPLICATE_IN_FILE' | 'EXISTING';
  issues: ImportIssue[];
  data: NormalizedPatientRow | null;
  dedupKey: string | null;
  externalRef: string | null;
}

export function createImportsService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  function audit(
    tx: Transaction,
    actor: UserActor,
    action: string,
    batchId: string,
    meta: RequestMeta,
    counts?: Partial<ImportCounts>,
  ) {
    return recordAudit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      action,
      entityType: 'import_batch',
      entityId: batchId,
      changes: counts
        ? Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, { to: v }]))
        : null,
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  async function lockBatch(tx: Transaction, clinicId: string, id: string): Promise<ImportBatch> {
    const [batch] = await tx
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.clinicId, clinicId), eq(importBatches.id, id)))
      .for('update');
    if (!batch) throw notFound();
    return batch;
  }

  function requireStatus(batch: ImportBatch, status: ImportBatch['status']) {
    if (batch.status !== status) {
      throw new AppError(
        'CONFLICT',
        `Opération impossible : import au statut ${batch.status}`,
        409,
      );
    }
  }

  /** Recalcule les compteurs à partir des lignes (source de vérité). */
  async function recount(
    tx: Transaction,
    batch: ImportBatch,
    extra: Partial<ImportCounts> = {},
  ): Promise<ImportCounts> {
    const [row] = await tx
      .select({
        received: sql<number>`count(*)::int`,
        valid: sql<number>`count(*) filter (where ${importRows.status} = 'VALID')::int`,
        invalid: sql<number>`count(*) filter (where ${importRows.status} = 'INVALID')::int`,
        duplicateInFile: sql<number>`count(*) filter (where ${importRows.status} = 'DUPLICATE_IN_FILE')::int`,
        existing: sql<number>`count(*) filter (where ${importRows.status} = 'EXISTING')::int`,
        withWarnings: sql<number>`count(*) filter (where ${importRows.issues} @> '[{"severity":"warning"}]')::int`,
      })
      .from(importRows)
      .where(and(eq(importRows.clinicId, batch.clinicId), eq(importRows.batchId, batch.id)));
    const counts = { ...batch.counts, ...row, ...extra };
    await tx.update(importBatches).set({ counts }).where(eq(importBatches.id, batch.id));
    return counts;
  }

  /** Patients déjà présents : même numéro de dossier, ou même identité avec date de naissance. */
  async function findExisting(tx: Transaction, clinicId: string, rows: Prepared[]) {
    const refs = rows.map((r) => r.externalRef).filter((r): r is string => r !== null);
    const names = [
      ...new Set(
        rows
          .filter((r) => r.data)
          .map((r) => patientSearchText(r.data!.lastName, r.data!.firstName)),
      ),
    ];
    if (refs.length === 0 && names.length === 0) {
      return {
        refs: new Set<string>(),
        identities: new Set<string>(),
        names: new Map<string, (string | null)[]>(),
      };
    }
    const found = await tx
      .select({ ref: patients.externalRef, search: patients.searchText, birth: patients.birthDate })
      .from(patients)
      .where(
        and(
          eq(patients.clinicId, clinicId),
          or(
            refs.length > 0 ? inArray(patients.externalRef, refs) : undefined,
            names.length > 0 ? inArray(patients.searchText, names) : undefined,
          ),
        ),
      );
    const byName = new Map<string, (string | null)[]>();
    for (const p of found) byName.set(p.search, [...(byName.get(p.search) ?? []), p.birth]);
    const identityKeys = new Set(found.filter((p) => p.birth).map((p) => `${p.search}|${p.birth}`));
    return {
      refs: new Set(found.map((p) => p.ref).filter((r): r is string => r !== null)),
      identities: identityKeys,
      names: byName,
    };
  }

  function classifyAgainstExisting(
    row: Prepared,
    existing: Awaited<ReturnType<typeof findExisting>>,
  ) {
    if (row.status !== 'VALID' || !row.data) return;
    const search = patientSearchText(row.data.lastName, row.data.firstName);
    const sameRef = row.externalRef !== null && existing.refs.has(row.externalRef);
    const sameIdentity =
      row.data.birthDate !== null && existing.identities.has(`${search}|${row.data.birthDate}`);
    if (sameRef || sameIdentity) {
      row.status = 'EXISTING';
      row.issues.push({
        field: sameRef ? 'externalRef' : null,
        code: 'EXISTING_PATIENT',
        severity: 'error',
      });
      return;
    }
    // Même nom sans date de naissance d'un côté : doute, la ligne reste importable.
    const births = existing.names.get(search);
    if (births && births.some((b) => b === null || row.data!.birthDate === null)) {
      row.issues.push({ field: null, code: 'POSSIBLE_DUPLICATE', severity: 'warning' });
    }
  }

  async function create(
    actor: UserActor,
    input: CreateImportRequest,
    meta: RequestMeta,
  ): Promise<ImportSummary> {
    authorize(actor, 'data.import');
    const data = createImportRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      // Brouillons abandonnés de ce cabinet : effacés (minimisation des données).
      const staleBefore = new Date(now().getTime() - DRAFT_RETENTION_HOURS * 3_600_000);
      const stale = await tx
        .update(importBatches)
        .set({ status: 'DISCARDED' })
        .where(
          and(
            eq(importBatches.clinicId, actor.clinicId),
            eq(importBatches.status, 'DRAFT'),
            lt(importBatches.createdAt, staleBefore),
          ),
        )
        .returning({ id: importBatches.id });
      if (stale.length > 0) {
        await tx.delete(importRows).where(
          and(
            eq(importRows.clinicId, actor.clinicId),
            inArray(
              importRows.batchId,
              stale.map((s) => s.id),
            ),
          ),
        );
      }
      const id = uuidv7();
      const [batch] = await tx
        .insert(importBatches)
        .values({
          id,
          clinicId: actor.clinicId,
          kind: data.kind,
          fileName: data.fileName,
          dateFormat: data.dateFormat,
          totalRows: data.totalRows,
          counts: EMPTY_COUNTS,
          createdBy: actor.userId,
          createdAt: now(),
        })
        .returning();
      if (!batch) throw new Error('Import non créé');
      await audit(tx, actor, 'import.created', id, meta, { received: 0 });
      return toSummary(batch);
    });
  }

  async function addRows(
    actor: UserActor,
    batchId: string,
    input: { rows: ImportRowInput[] },
  ): Promise<ImportSummary> {
    authorize(actor, 'data.import');
    const { rows } = addImportRowsRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const batch = await lockBatch(tx, actor.clinicId, batchId);
      requireStatus(batch, 'DRAFT');
      if (batch.counts.received + rows.length > batch.totalRows) {
        throw new AppError('BAD_REQUEST', 'Plus de lignes reçues que le nombre annoncé', 400);
      }
      const [clinic] = await tx
        .select({ country: clinics.countryCode })
        .from(clinics)
        .where(eq(clinics.id, actor.clinicId));
      const context = {
        dateFormat: batch.dateFormat,
        country: clinic?.country ?? 'FR',
        today: now(),
      };

      const prepared: Prepared[] = rows.map((row) => {
        const result = validatePatientRow(row, context);
        if (result.status === 'INVALID') {
          return {
            line: row.line,
            status: 'INVALID',
            issues: result.issues,
            data: null,
            dedupKey: null,
            externalRef: null,
          };
        }
        return {
          line: row.line,
          status: 'VALID',
          issues: result.issues,
          data: result.data,
          // Seules les identités avec date de naissance servent au dédoublonnage automatique.
          dedupKey: result.data.birthDate ? result.identityKey : null,
          externalRef: result.data.externalRef,
        };
      });

      // Doublons dans le fichier : avec les lignes déjà reçues, puis au sein de ce paquet.
      const keys = prepared.map((p) => p.dedupKey).filter((k): k is string => k !== null);
      const refs = prepared.map((p) => p.externalRef).filter((r): r is string => r !== null);
      const earlier =
        keys.length + refs.length === 0
          ? []
          : await tx
              .select({ key: importRows.dedupKey, ref: importRows.externalRef })
              .from(importRows)
              .where(
                and(
                  eq(importRows.clinicId, actor.clinicId),
                  eq(importRows.batchId, batchId),
                  eq(importRows.status, 'VALID'),
                  or(
                    keys.length > 0 ? inArray(importRows.dedupKey, keys) : undefined,
                    refs.length > 0 ? inArray(importRows.externalRef, refs) : undefined,
                  ),
                ),
              );
      const seenKeys = new Set(earlier.map((e) => e.key).filter(Boolean));
      const seenRefs = new Set(earlier.map((e) => e.ref).filter(Boolean));
      for (const row of prepared) {
        if (row.status !== 'VALID') continue;
        const dupKey = row.dedupKey !== null && seenKeys.has(row.dedupKey);
        const dupRef = row.externalRef !== null && seenRefs.has(row.externalRef);
        if (dupKey || dupRef) {
          row.status = 'DUPLICATE_IN_FILE';
          row.issues.push({
            field: dupRef ? 'externalRef' : null,
            code: 'DUPLICATE_IN_FILE',
            severity: 'error',
          });
          continue;
        }
        if (row.dedupKey) seenKeys.add(row.dedupKey);
        if (row.externalRef) seenRefs.add(row.externalRef);
      }

      const existing = await findExisting(tx, actor.clinicId, prepared);
      prepared.forEach((row) => classifyAgainstExisting(row, existing));

      try {
        await tx.insert(importRows).values(
          prepared.map((p) => ({
            clinicId: actor.clinicId,
            batchId,
            line: p.line,
            status: p.status,
            dedupKey: p.dedupKey,
            externalRef: p.externalRef,
            // Données conservées seulement si elles peuvent être importées.
            data: p.status === 'VALID' ? { ...p.data } : null,
            issues: p.issues,
          })),
        );
      } catch (error) {
        const code = (error as { cause?: { code?: string } }).cause?.code;
        if (code === '23505')
          throw new AppError('CONFLICT', 'Ligne déjà reçue pour cet import', 409);
        throw error;
      }
      const counts = await recount(tx, batch);
      return toSummary({ ...batch, counts });
    });
  }

  async function get(actor: UserActor, id: string): Promise<ImportSummary> {
    authorize(actor, 'data.import');
    return withTenant(db, actor.clinicId, async (tx) => {
      const [batch] = await tx
        .select()
        .from(importBatches)
        .where(and(eq(importBatches.clinicId, actor.clinicId), eq(importBatches.id, id)));
      if (!batch) throw notFound();
      return toSummary(batch);
    });
  }

  async function list(actor: UserActor): Promise<ImportSummary[]> {
    authorize(actor, 'data.import');
    const rows = await withTenant(db, actor.clinicId, (tx) =>
      tx
        .select()
        .from(importBatches)
        .where(eq(importBatches.clinicId, actor.clinicId))
        .orderBy(desc(importBatches.createdAt))
        .limit(20),
    );
    return rows.map(toSummary);
  }

  async function report(actor: UserActor, id: string, query: Record<string, unknown>) {
    authorize(actor, 'data.import');
    const q = importRowsReportQuerySchema.parse(query);
    return withTenant(db, actor.clinicId, async (tx) => {
      const where = and(
        eq(importRows.clinicId, actor.clinicId),
        eq(importRows.batchId, id),
        q.onlyIssues ? sql`jsonb_array_length(${importRows.issues}) > 0` : undefined,
      );
      const [total] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(importRows)
        .where(where);
      const rows = await tx
        .select({ line: importRows.line, status: importRows.status, issues: importRows.issues })
        .from(importRows)
        .where(where)
        .orderBy(asc(importRows.line))
        .limit(q.limit)
        .offset(q.offset);
      return { rows, total: total?.n ?? 0 };
    });
  }

  async function commit(actor: UserActor, id: string, meta: RequestMeta): Promise<ImportSummary> {
    authorize(actor, 'data.import');
    return withTenant(db, actor.clinicId, async (tx) => {
      const batch = await lockBatch(tx, actor.clinicId, id);
      requireStatus(batch, 'DRAFT');
      if (batch.counts.received !== batch.totalRows) {
        throw new AppError(
          'BAD_REQUEST',
          `Import incomplet : ${batch.counts.received} ligne(s) reçue(s) sur ${batch.totalRows}`,
          400,
        );
      }
      const valid = await tx
        .select()
        .from(importRows)
        .where(
          and(
            eq(importRows.clinicId, actor.clinicId),
            eq(importRows.batchId, id),
            eq(importRows.status, 'VALID'),
          ),
        )
        .orderBy(asc(importRows.line));
      const prepared: (Prepared & { rowId: string })[] = valid.map((r) => ({
        rowId: r.id,
        line: r.line,
        status: 'VALID',
        issues: [...r.issues],
        data: r.data as unknown as NormalizedPatientRow,
        dedupKey: r.dedupKey,
        externalRef: r.externalRef,
      }));
      // Nouvelle vérification : des patients ont pu être créés depuis l'envoi des lignes.
      const existing = await findExisting(tx, actor.clinicId, prepared);
      prepared.forEach((row) => classifyAgainstExisting(row, existing));
      const nowExisting = prepared.filter((p) => p.status === 'EXISTING');
      for (const row of nowExisting) {
        await tx
          .update(importRows)
          .set({ status: 'EXISTING', issues: row.issues })
          .where(eq(importRows.id, row.rowId));
      }

      const toCreate = prepared.filter((p) => p.status === 'VALID');
      const createdAt = now();
      for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
        const chunk = toCreate.slice(i, i + INSERT_CHUNK).map((row) => ({ row, id: uuidv7() }));
        await tx.insert(patients).values(
          chunk.map(({ row, id: patientId }) => ({
            id: patientId,
            clinicId: actor.clinicId,
            lastName: row.data!.lastName,
            firstName: row.data!.firstName,
            birthDate: row.data!.birthDate,
            email: row.data!.email,
            administrativeNote: row.data!.administrativeNote,
            externalRef: row.data!.externalRef,
            createdSource: 'IMPORT' as const,
            importBatchId: id,
            searchText: patientSearchText(row.data!.lastName, row.data!.firstName),
            createdBy: actor.userId,
            createdAt,
          })),
        );
        const contacts = chunk.flatMap(({ row, id: patientId }) =>
          row.data!.phones.map((phone, index) => ({
            clinicId: actor.clinicId,
            patientId,
            phoneE164: phone,
            relationship: 'SELF' as const,
            isPrimary: index === 0,
          })),
        );
        if (contacts.length > 0) await tx.insert(patientContacts).values(contacts);
        for (const { row, id: patientId } of chunk) {
          await tx.update(importRows).set({ patientId }).where(eq(importRows.id, row.rowId));
        }
      }
      // Minimisation : les données personnelles des lignes ne sont plus nécessaires.
      await tx
        .update(importRows)
        .set({ data: null })
        .where(
          and(
            eq(importRows.clinicId, actor.clinicId),
            eq(importRows.batchId, id),
            isNotNull(importRows.data),
          ),
        );
      await tx
        .update(importBatches)
        .set({ status: 'COMMITTED', committedAt: createdAt })
        .where(eq(importBatches.id, id));
      const counts = await recount(
        tx,
        { ...batch, status: 'COMMITTED' },
        { created: toCreate.length },
      );
      await audit(tx, actor, 'import.committed', id, meta, {
        created: toCreate.length,
        existing: counts.existing,
        invalid: counts.invalid,
      });
      return toSummary({ ...batch, status: 'COMMITTED', committedAt: createdAt, counts });
    });
  }

  /**
   * Annulation : supprime les patients créés par l'import et jamais modifiés depuis
   * (version 1, aucune note médicale). Les autres sont conservés et comptés.
   */
  async function revert(actor: UserActor, id: string, meta: RequestMeta) {
    authorize(actor, 'data.import');
    return withTenant(db, actor.clinicId, async (tx) => {
      const batch = await lockBatch(tx, actor.clinicId, id);
      requireStatus(batch, 'COMMITTED');
      const deleted = await tx
        .delete(patients)
        .where(
          and(
            eq(patients.clinicId, actor.clinicId),
            eq(patients.importBatchId, id),
            eq(patients.version, 1),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(patientMedicalNotes)
                .where(eq(patientMedicalNotes.patientId, patients.id)),
            ),
            // Un patient qui a (ou a eu) un rendez-vous n'est jamais supprimé (ADR 0007).
            notExists(
              tx
                .select({ one: sql`1` })
                .from(appointments)
                .where(eq(appointments.patientId, patients.id)),
            ),
          ),
        )
        .returning({ id: patients.id });
      const [kept] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(patients)
        .where(and(eq(patients.clinicId, actor.clinicId), eq(patients.importBatchId, id)));
      const revertedAt = now();
      await tx
        .update(importBatches)
        .set({ status: 'REVERTED', revertedAt })
        .where(eq(importBatches.id, id));
      const counts = await recount(tx, batch, { reverted: deleted.length });
      await audit(tx, actor, 'import.reverted', id, meta, { reverted: deleted.length });
      return {
        summary: toSummary({ ...batch, status: 'REVERTED', revertedAt, counts }),
        deleted: deleted.length,
        kept: kept?.n ?? 0,
      };
    });
  }

  async function discard(actor: UserActor, id: string, meta: RequestMeta): Promise<ImportSummary> {
    authorize(actor, 'data.import');
    return withTenant(db, actor.clinicId, async (tx) => {
      const batch = await lockBatch(tx, actor.clinicId, id);
      requireStatus(batch, 'DRAFT');
      await tx
        .delete(importRows)
        .where(and(eq(importRows.clinicId, actor.clinicId), eq(importRows.batchId, id)));
      await tx.update(importBatches).set({ status: 'DISCARDED' }).where(eq(importBatches.id, id));
      const counts = await recount(tx, batch);
      await audit(tx, actor, 'import.discarded', id, meta);
      return toSummary({ ...batch, status: 'DISCARDED', counts });
    });
  }

  return { create, addRows, get, list, report, commit, revert, discard };
}
