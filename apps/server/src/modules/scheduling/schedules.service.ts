import {
  MAX_AVAILABILITY_DAYS,
  MAX_BLOCK_LIST_DAYS,
  availabilityQuerySchema,
  createBlockRequestSchema,
  listBlocksQuerySchema,
  minutesToTime,
  replaceBlockRequestSchema,
  setScheduleRequestSchema,
  timeToMinutes,
  type AvailabilityBlock,
  type AvailabilityResponse,
  type BlockTiming,
  type CreateBlockRequest,
  type ReplaceBlockRequest,
  type SchedulePeriod,
  type SetScheduleRequest,
} from '@dental/shared';
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import {
  availabilityBlocks,
  clinics,
  practitioners,
  workingIntervals,
  workingSchedules,
  type AvailabilityBlockRow,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { PG_EXCLUSION_VIOLATION, pgErrorCode } from '../../lib/pg-errors';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize, authorizeAny } from '../auth/authorize';
import { SCHEDULE_PERMISSIONS, authorizeSchedule } from './access';
import { computeAvailability, type Unavailability } from './availability';
import {
  addDays,
  daysBetween,
  localDateTimeToInstant,
  localToday,
  wallClockToInstant,
} from './local-time';
import { lockPractitioners } from './locks';

export type SchedulesService = ReturnType<typeof createSchedulesService>;

const DAY_MS = 86_400_000;
/** Horizon maximal pour programmer de nouveaux horaires. */
const MAX_SCHEDULE_HORIZON_DAYS = 730;

const invalid = (message: string) => new AppError('VALIDATION_FAILED', message, 400);
const practitionerNotFound = () => new AppError('NOT_FOUND', 'Praticien introuvable', 404);
const blockNotFound = () => new AppError('NOT_FOUND', 'Indisponibilité introuvable', 404);
const periodNotFound = () => new AppError('NOT_FOUND', "Période d'horaires introuvable", 404);
const staleVersion = () =>
  new AppError(
    'CONFLICT',
    "L'agenda a été modifié par quelqu'un d'autre entre-temps. Rechargez la page.",
    409,
  );
const archived = () =>
  new AppError('CONFLICT', "Ce praticien est archivé : son agenda n'est plus modifiable", 409);

type AuditValue = string | number | boolean | null;

/**
 * Horaires de travail (périodes versionnées), indisponibilités (absences, blocages) et calcul
 * des disponibilités, dans le fuseau du cabinet. Voir docs/adr/0006.
 */
export function createSchedulesService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  function audit(
    tx: Transaction,
    actor: UserActor,
    action: string,
    entity: { type: 'practitioner' | 'availability_block' | 'clinic'; id: string },
    meta: RequestMeta,
    changes: Record<string, { from?: AuditValue; to?: AuditValue }> | null = null,
  ) {
    return recordAudit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      action,
      entityType: entity.type,
      entityId: entity.id,
      changes,
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  async function clinicZone(tx: Transaction, clinicId: string): Promise<string> {
    const [clinic] = await tx
      .select({ timezone: clinics.timezone })
      .from(clinics)
      .where(eq(clinics.id, clinicId));
    if (!clinic) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
    return clinic.timezone;
  }

  async function practitionerRow(tx: Transaction, clinicId: string, id: string) {
    const [row] = await tx
      .select({ id: practitioners.id, userId: practitioners.userId, status: practitioners.status })
      .from(practitioners)
      .where(and(eq(practitioners.clinicId, clinicId), eq(practitioners.id, id)));
    if (!row) throw practitionerNotFound();
    return row;
  }

  /** Praticien dont l'agenda va être modifié : existant, actif, et dans la portée de l'acteur. */
  async function editablePractitioner(tx: Transaction, actor: UserActor, id: string) {
    const row = await practitionerRow(tx, actor.clinicId, id);
    authorizeSchedule(actor, row);
    if (row.status !== 'ACTIVE') throw archived();
    return row;
  }

  // --- Horaires de travail -----------------------------------------------------------------

  async function readPeriods(
    tx: Transaction,
    clinicId: string,
    practitionerIds: readonly string[],
    range?: { from: string; to: string },
  ) {
    if (practitionerIds.length === 0) return [];
    const schedules = await tx
      .select()
      .from(workingSchedules)
      .where(
        and(
          eq(workingSchedules.clinicId, clinicId),
          inArray(workingSchedules.practitionerId, [...practitionerIds]),
          range ? lte(workingSchedules.validFrom, range.to) : undefined,
          range
            ? or(isNull(workingSchedules.validTo), gt(workingSchedules.validTo, range.from))
            : undefined,
        ),
      )
      .orderBy(asc(workingSchedules.validFrom));
    const intervals =
      schedules.length === 0
        ? []
        : await tx
            .select()
            .from(workingIntervals)
            .where(
              and(
                eq(workingIntervals.clinicId, clinicId),
                inArray(
                  workingIntervals.scheduleId,
                  schedules.map((s) => s.id),
                ),
              ),
            )
            .orderBy(asc(workingIntervals.weekday), asc(workingIntervals.startMinute));
    return schedules.map((s) => ({
      ...s,
      intervals: intervals.filter((i) => i.scheduleId === s.id),
    }));
  }

  function toPeriod(period: Awaited<ReturnType<typeof readPeriods>>[number]): SchedulePeriod {
    return {
      id: period.id,
      validFrom: period.validFrom,
      validTo: period.validTo,
      version: period.version,
      intervals: period.intervals.map((i) => ({
        weekday: i.weekday,
        start: minutesToTime(i.startMinute),
        end: minutesToTime(i.endMinute),
      })),
    };
  }

  async function listSchedules(actor: UserActor, practitionerId: string) {
    authorize(actor, 'appointment.read');
    return withTenant(db, actor.clinicId, async (tx) => {
      await practitionerRow(tx, actor.clinicId, practitionerId);
      return (await readPeriods(tx, actor.clinicId, [practitionerId])).map(toPeriod);
    });
  }

  /**
   * Nouveaux horaires à partir de `validFrom` : remplace la période qui commence ce jour-là,
   * sinon arrête la période en cours à cette date. Les périodes futures sont conservées.
   */
  async function setSchedule(
    actor: UserActor,
    practitionerId: string,
    input: SetScheduleRequest,
    meta: RequestMeta,
  ): Promise<SchedulePeriod[]> {
    authorizeAny(actor, SCHEDULE_PERMISSIONS);
    const data = setScheduleRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      await editablePractitioner(tx, actor, practitionerId);
      const today = localToday(await clinicZone(tx, actor.clinicId), now());
      if (data.validFrom < today) {
        throw invalid("Les horaires s'appliquent à partir d'aujourd'hui ou d'une date future");
      }
      if (daysBetween(today, data.validFrom) > MAX_SCHEDULE_HORIZON_DAYS) {
        throw invalid('Date de début trop lointaine (2 ans au plus)');
      }
      await lockPractitioners(tx, [practitionerId]);
      const periods = await readPeriods(tx, actor.clinicId, [practitionerId]);
      const covering = periods.find(
        (p) => p.validFrom <= data.validFrom && (p.validTo === null || data.validFrom < p.validTo),
      );
      // Identité et version : une période créée entre-temps peut porter le même numéro de version.
      if (
        (covering?.id ?? null) !== (data.basePeriod?.id ?? null) ||
        (covering?.version ?? null) !== (data.basePeriod?.version ?? null)
      ) {
        throw staleVersion();
      }

      let scheduleId: string;
      if (covering && covering.validFrom === data.validFrom) {
        await tx
          .delete(workingIntervals)
          .where(
            and(
              eq(workingIntervals.clinicId, actor.clinicId),
              eq(workingIntervals.scheduleId, covering.id),
            ),
          );
        await tx
          .update(workingSchedules)
          .set({ version: sql`${workingSchedules.version} + 1` })
          .where(
            and(
              eq(workingSchedules.clinicId, actor.clinicId),
              eq(workingSchedules.id, covering.id),
            ),
          );
        scheduleId = covering.id;
      } else {
        const validTo = covering
          ? covering.validTo
          : (periods.find((p) => p.validFrom > data.validFrom)?.validFrom ?? null);
        if (covering) {
          await tx
            .update(workingSchedules)
            .set({ validTo: data.validFrom, version: sql`${workingSchedules.version} + 1` })
            .where(
              and(
                eq(workingSchedules.clinicId, actor.clinicId),
                eq(workingSchedules.id, covering.id),
              ),
            );
        }
        const [row] = await tx
          .insert(workingSchedules)
          .values({ clinicId: actor.clinicId, practitionerId, validFrom: data.validFrom, validTo })
          .returning({ id: workingSchedules.id })
          .catch((error: unknown) => {
            // Filet de sécurité : le verrou rend ce cas impossible, la contrainte le garantit.
            if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) throw staleVersion();
            throw error;
          });
        scheduleId = row!.id;
      }
      if (data.intervals.length > 0) {
        await tx.insert(workingIntervals).values(
          data.intervals.map((i) => ({
            clinicId: actor.clinicId,
            scheduleId,
            weekday: i.weekday,
            startMinute: timeToMinutes(i.start),
            endMinute: timeToMinutes(i.end),
          })),
        );
      }
      await audit(
        tx,
        actor,
        'schedule.updated',
        { type: 'practitioner', id: practitionerId },
        meta,
        {
          validFrom: { to: data.validFrom },
          intervals: { to: data.intervals.length },
        },
      );
      return (await readPeriods(tx, actor.clinicId, [practitionerId])).map(toPeriod);
    });
  }

  /** Supprime une période qui n'a pas encore commencé ; la précédente la remplace. */
  async function deletePeriod(
    actor: UserActor,
    practitionerId: string,
    periodId: string,
    version: number,
    meta: RequestMeta,
  ): Promise<SchedulePeriod[]> {
    authorizeAny(actor, SCHEDULE_PERMISSIONS);
    return withTenant(db, actor.clinicId, async (tx) => {
      await editablePractitioner(tx, actor, practitionerId);
      const today = localToday(await clinicZone(tx, actor.clinicId), now());
      await lockPractitioners(tx, [practitionerId]);
      const periods = await readPeriods(tx, actor.clinicId, [practitionerId]);
      const target = periods.find((p) => p.id === periodId);
      if (!target) throw periodNotFound();
      if (target.version !== version) throw staleVersion();
      if (target.validFrom <= today) {
        throw invalid("Seule une période qui n'a pas encore commencé peut être supprimée");
      }
      const previous = periods.find((p) => p.validTo === target.validFrom);
      await tx
        .delete(workingSchedules)
        .where(
          and(eq(workingSchedules.clinicId, actor.clinicId), eq(workingSchedules.id, target.id)),
        );
      if (previous) {
        await tx
          .update(workingSchedules)
          .set({ validTo: target.validTo, version: sql`${workingSchedules.version} + 1` })
          .where(
            and(
              eq(workingSchedules.clinicId, actor.clinicId),
              eq(workingSchedules.id, previous.id),
            ),
          );
      }
      await audit(
        tx,
        actor,
        'schedule.period_deleted',
        { type: 'practitioner', id: practitionerId },
        meta,
        { validFrom: { from: target.validFrom } },
      );
      return (await readPeriods(tx, actor.clinicId, [practitionerId])).map(toPeriod);
    });
  }

  // --- Indisponibilités --------------------------------------------------------------------

  function blockInstants(zone: string, timing: BlockTiming) {
    let start: number;
    let end: number;
    if (timing.allDay) {
      if (timing.endDate < timing.startDate) {
        throw invalid('La date de fin précède la date de début');
      }
      start = wallClockToInstant(timing.startDate, 0, zone);
      end = wallClockToInstant(addDays(timing.endDate, 1), 0, zone);
    } else {
      const s = localDateTimeToInstant(timing.start, zone);
      const e = localDateTimeToInstant(timing.end, zone);
      for (const result of [s, e]) {
        if (!result.ok) {
          throw invalid(
            result.code === 'NONEXISTENT'
              ? "Cette heure n'existe pas ce jour-là (changement d'heure)"
              : 'Date ou heure invalide',
          );
        }
      }
      start = (s as { instant: number }).instant;
      end = (e as { instant: number }).instant;
      if (end <= start) throw invalid('La fin doit être après le début');
    }
    if (end - start > MAX_BLOCK_LIST_DAYS * DAY_MS) {
      throw invalid('Une indisponibilité ne peut pas dépasser un an');
    }
    return { startAt: new Date(start), endAt: new Date(end), allDay: timing.allDay };
  }

  function toBlock(row: AvailabilityBlockRow): AvailabilityBlock {
    return {
      id: row.id,
      practitionerId: row.practitionerId,
      kind: row.kind,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      allDay: row.allDay,
      label: row.label,
      version: row.version,
    };
  }

  /** Verrou d'un praticien, ou de tous ceux du cabinet pour une indisponibilité générale. */
  async function lockScope(tx: Transaction, clinicId: string, practitionerId: string | null) {
    const ids = practitionerId
      ? [practitionerId]
      : (
          await tx
            .select({ id: practitioners.id })
            .from(practitioners)
            .where(eq(practitioners.clinicId, clinicId))
        ).map((p) => p.id);
    await lockPractitioners(tx, ids);
  }

  function rangeInstants(zone: string, from: string, to: string) {
    return {
      start: new Date(wallClockToInstant(from, 0, zone)),
      end: new Date(wallClockToInstant(addDays(to, 1), 0, zone)),
    };
  }

  function checkRange(from: string, to: string, maxDays: number) {
    if (to < from) throw invalid('La date de fin précède la date de début');
    if (daysBetween(from, to) + 1 > maxDays) {
      throw invalid(`Période trop longue (${maxDays} jours au plus)`);
    }
  }

  async function readBlocks(
    tx: Transaction,
    clinicId: string,
    range: { start: Date; end: Date },
    practitionerIds?: readonly string[],
  ) {
    return tx
      .select()
      .from(availabilityBlocks)
      .where(
        and(
          eq(availabilityBlocks.clinicId, clinicId),
          lt(availabilityBlocks.startAt, range.end),
          gt(availabilityBlocks.endAt, range.start),
          practitionerIds
            ? or(
                isNull(availabilityBlocks.practitionerId),
                practitionerIds.length > 0
                  ? inArray(availabilityBlocks.practitionerId, [...practitionerIds])
                  : undefined,
              )
            : undefined,
        ),
      )
      .orderBy(asc(availabilityBlocks.startAt), asc(availabilityBlocks.id));
  }

  async function listBlocks(
    actor: UserActor,
    query: Record<string, unknown>,
  ): Promise<AvailabilityBlock[]> {
    authorize(actor, 'appointment.read');
    const q = listBlocksQuerySchema.parse(query);
    checkRange(q.from, q.to, MAX_BLOCK_LIST_DAYS);
    return withTenant(db, actor.clinicId, async (tx) => {
      const zone = await clinicZone(tx, actor.clinicId);
      if (q.practitionerId) await practitionerRow(tx, actor.clinicId, q.practitionerId);
      const rows = await readBlocks(
        tx,
        actor.clinicId,
        rangeInstants(zone, q.from, q.to),
        q.practitionerId ? [q.practitionerId] : undefined,
      );
      return rows.map(toBlock);
    });
  }

  function blockAuditChanges(
    before: { kind: string; startAt: Date; endAt: Date; allDay: boolean } | null,
    after: { kind: string; startAt: Date; endAt: Date; allDay: boolean },
  ) {
    // Le libellé (texte libre) n'est pas recopié dans l'audit.
    return {
      kind: { from: before?.kind ?? null, to: after.kind },
      startAt: { from: before?.startAt.toISOString() ?? null, to: after.startAt.toISOString() },
      endAt: { from: before?.endAt.toISOString() ?? null, to: after.endAt.toISOString() },
      allDay: { from: before?.allDay ?? null, to: after.allDay },
    };
  }

  async function createBlock(
    actor: UserActor,
    input: CreateBlockRequest,
    meta: RequestMeta,
  ): Promise<AvailabilityBlock> {
    authorizeAny(actor, SCHEDULE_PERMISSIONS);
    const data = createBlockRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      if (data.practitionerId) await editablePractitioner(tx, actor, data.practitionerId);
      else authorizeSchedule(actor, null);
      const times = blockInstants(await clinicZone(tx, actor.clinicId), data);
      await lockScope(tx, actor.clinicId, data.practitionerId);
      // Phase 5 : lister ici les rendez-vous en conflit, sans les modifier (ADR 0006, R6).
      const [row] = await tx
        .insert(availabilityBlocks)
        .values({
          clinicId: actor.clinicId,
          practitionerId: data.practitionerId,
          kind: data.kind,
          ...times,
          label: data.label || null,
          createdBy: actor.userId,
        })
        .returning();
      await audit(
        tx,
        actor,
        'availability_block.created',
        { type: 'availability_block', id: row!.id },
        meta,
        { practitionerId: { to: data.practitionerId }, ...blockAuditChanges(null, row!) },
      );
      return toBlock(row!);
    });
  }

  async function blockForUpdate(tx: Transaction, actor: UserActor, id: string) {
    const [block] = await tx
      .select()
      .from(availabilityBlocks)
      .where(and(eq(availabilityBlocks.clinicId, actor.clinicId), eq(availabilityBlocks.id, id)));
    if (!block) throw blockNotFound();
    if (block.practitionerId) await editablePractitioner(tx, actor, block.practitionerId);
    else authorizeSchedule(actor, null);
    return block;
  }

  async function replaceBlock(
    actor: UserActor,
    id: string,
    input: ReplaceBlockRequest,
    meta: RequestMeta,
  ): Promise<AvailabilityBlock> {
    authorizeAny(actor, SCHEDULE_PERMISSIONS);
    const data = replaceBlockRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const before = await blockForUpdate(tx, actor, id);
      const times = blockInstants(await clinicZone(tx, actor.clinicId), data);
      await lockScope(tx, actor.clinicId, before.practitionerId);
      const [row] = await tx
        .update(availabilityBlocks)
        .set({
          kind: data.kind,
          ...times,
          label: data.label || null,
          version: sql`${availabilityBlocks.version} + 1`,
        })
        .where(
          and(
            eq(availabilityBlocks.clinicId, actor.clinicId),
            eq(availabilityBlocks.id, id),
            eq(availabilityBlocks.version, data.version),
          ),
        )
        .returning();
      if (!row) throw staleVersion();
      await audit(
        tx,
        actor,
        'availability_block.updated',
        { type: 'availability_block', id },
        meta,
        blockAuditChanges(before, row),
      );
      return toBlock(row);
    });
  }

  async function deleteBlock(
    actor: UserActor,
    id: string,
    version: number,
    meta: RequestMeta,
  ): Promise<void> {
    authorizeAny(actor, SCHEDULE_PERMISSIONS);
    await withTenant(db, actor.clinicId, async (tx) => {
      const before = await blockForUpdate(tx, actor, id);
      await lockScope(tx, actor.clinicId, before.practitionerId);
      const deleted = await tx
        .delete(availabilityBlocks)
        .where(
          and(
            eq(availabilityBlocks.clinicId, actor.clinicId),
            eq(availabilityBlocks.id, id),
            eq(availabilityBlocks.version, version),
          ),
        )
        .returning({ id: availabilityBlocks.id });
      if (deleted.length === 0) throw staleVersion();
      await audit(
        tx,
        actor,
        'availability_block.deleted',
        { type: 'availability_block', id },
        meta,
        {
          practitionerId: { from: before.practitionerId },
          kind: { from: before.kind },
          startAt: { from: before.startAt.toISOString() },
          endAt: { from: before.endAt.toISOString() },
        },
      );
    });
  }

  // --- Disponibilités ----------------------------------------------------------------------

  async function availability(
    actor: UserActor,
    query: Record<string, unknown>,
  ): Promise<AvailabilityResponse> {
    authorize(actor, 'appointment.read');
    const q = availabilityQuerySchema.parse(query);
    checkRange(q.from, q.to, MAX_AVAILABILITY_DAYS);
    return withTenant(db, actor.clinicId, async (tx) => {
      const zone = await clinicZone(tx, actor.clinicId);
      const ids = q.practitionerId
        ? [(await practitionerRow(tx, actor.clinicId, q.practitionerId)).id]
        : (
            await tx
              .select({ id: practitioners.id })
              .from(practitioners)
              .where(
                and(eq(practitioners.clinicId, actor.clinicId), eq(practitioners.status, 'ACTIVE')),
              )
              .orderBy(asc(practitioners.displayName), asc(practitioners.id))
          ).map((p) => p.id);
      const periods = await readPeriods(tx, actor.clinicId, ids, { from: q.from, to: q.to });
      const blocks = await readBlocks(tx, actor.clinicId, rangeInstants(zone, q.from, q.to), ids);
      const toIso = (list: { start: number; end: number }[]) =>
        list.map((i) => ({
          start: new Date(i.start).toISOString(),
          end: new Date(i.end).toISOString(),
        }));
      return {
        timezone: zone,
        from: q.from,
        to: q.to,
        practitioners: ids.map((id) => {
          const unavailabilities: Unavailability[] = blocks
            .filter((b) => b.practitionerId === null || b.practitionerId === id)
            .map((b) => ({ kind: b.kind, start: b.startAt.getTime(), end: b.endAt.getTime() }));
          const result = computeAvailability({
            periods: periods
              .filter((p) => p.practitionerId === id)
              .map((p) => ({ validFrom: p.validFrom, validTo: p.validTo, intervals: p.intervals })),
            unavailabilities,
            from: q.from,
            to: q.to,
            zone,
          });
          return {
            practitionerId: id,
            working: toIso(result.working),
            available: toIso(result.available),
          };
        }),
        blocks: blocks.map(toBlock),
      };
    });
  }

  return {
    listSchedules,
    setSchedule,
    deletePeriod,
    listBlocks,
    createBlock,
    replaceBlock,
    deleteBlock,
    availability,
  };
}
