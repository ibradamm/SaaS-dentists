import type { AvailabilityBlock } from '@dental/shared';
import { and, asc, eq, gt, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import {
  availabilityBlocks,
  clinics,
  practitioners,
  workingIntervals,
  workingSchedules,
  type AvailabilityBlockRow,
} from '../../db/schema';
import { AppError } from '../../lib/errors';
import { addDays, daysBetween, wallClockToInstant } from './local-time';
import { lockPractitioners } from './locks';

/*
 * Lectures d'agenda partagées par les services horaires et rendez-vous. Chaque requête filtre
 * explicitement par cabinet et s'exécute dans la transaction withTenant de l'appelant.
 */

export async function clinicZone(tx: Transaction, clinicId: string): Promise<string> {
  const [clinic] = await tx
    .select({ timezone: clinics.timezone })
    .from(clinics)
    .where(eq(clinics.id, clinicId));
  if (!clinic) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
  return clinic.timezone;
}

/** Périodes d'horaires des praticiens, avec leurs plages ; restreintes à des dates si demandé. */
export async function readPeriods(
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
export type PeriodWithIntervals = Awaited<ReturnType<typeof readPeriods>>[number];

/**
 * Indisponibilités qui chevauchent une période. Avec des praticiens : les leurs et celles de
 * tout le cabinet ; sans : toutes.
 */
export async function readBlocks(
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

export function toBlock(row: AvailabilityBlockRow): AvailabilityBlock {
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
export async function lockScope(
  tx: Transaction,
  clinicId: string,
  practitionerId: string | null,
): Promise<string[]> {
  const ids = practitionerId
    ? [practitionerId]
    : (
        await tx
          .select({ id: practitioners.id })
          .from(practitioners)
          .where(eq(practitioners.clinicId, clinicId))
      ).map((p) => p.id);
  await lockPractitioners(tx, ids);
  return ids;
}

/** Instants de début et de fin (exclue) des dates locales `from` à `to` incluses. */
export function rangeInstants(zone: string, from: string, to: string) {
  return {
    start: new Date(wallClockToInstant(from, 0, zone)),
    end: new Date(wallClockToInstant(addDays(to, 1), 0, zone)),
  };
}

export function checkRange(from: string, to: string, maxDays: number) {
  if (to < from) {
    throw new AppError('VALIDATION_FAILED', 'La date de fin précède la date de début', 400);
  }
  if (daysBetween(from, to) + 1 > maxDays) {
    throw new AppError('VALIDATION_FAILED', `Période trop longue (${maxDays} jours au plus)`, 400);
  }
}
