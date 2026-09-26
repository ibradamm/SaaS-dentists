import type { AvailabilityBlock, BlockKind } from '@dental/shared';
import { formatLocalDate, formatTime, localDateOf } from '../../lib/dates';

export const BLOCK_KIND_LABELS: Record<BlockKind, string> = {
  ABSENCE: 'Absence',
  BLOCK: 'Créneau bloqué',
};

/** Plages « 09:00–12:00, 14:00–18:00 » dans le fuseau du cabinet. */
export function formatWindows(list: { start: string; end: string }[], timeZone: string): string {
  if (list.length === 0) return '—';
  return list
    .map((w) => `${formatTime(w.start, timeZone)}–${formatTime(w.end, timeZone)}`)
    .join(', ');
}

/** Dernière date locale couverte par un intervalle [début, fin). */
export function lastLocalDate(endAt: string, timeZone: string): string {
  return localDateOf(new Date(endAt).getTime() - 1, timeZone);
}

/** Période d'une indisponibilité, lisible, dans le fuseau du cabinet. */
export function formatBlockPeriod(block: AvailabilityBlock, timeZone: string): string {
  const startDate = localDateOf(block.startAt, timeZone);
  const endDate = lastLocalDate(block.endAt, timeZone);
  if (block.allDay) {
    return startDate === endDate
      ? `Le ${formatLocalDate(startDate)}`
      : `Du ${formatLocalDate(startDate)} au ${formatLocalDate(endDate)}`;
  }
  const start = formatTime(block.startAt, timeZone);
  const end = formatTime(block.endAt, timeZone);
  const endDay = localDateOf(block.endAt, timeZone);
  return startDate === endDay
    ? `Le ${formatLocalDate(startDate)} de ${start} à ${end}`
    : `Du ${formatLocalDate(startDate)} ${start} au ${formatLocalDate(endDay)} ${end}`;
}
