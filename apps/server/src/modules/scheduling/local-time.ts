import { DateTime } from 'luxon';

/*
 * Conversions entre l'heure locale d'un cabinet (fuseau IANA) et les instants UTC. Toute
 * conversion passe par ce module : une heure locale se construit toujours en heure murale
 * (date + heure + minute dans le fuseau), jamais par « minuit + N minutes », faux d'une heure
 * les jours de changement d'heure (docs/adr/0006).
 */

export const MINUTES_PER_DAY = 1440;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

function calendarDate(date: string): DateTime {
  const parsed = LOCAL_DATE.test(date) ? DateTime.fromISO(date, { zone: 'UTC' }) : null;
  if (!parsed?.isValid) throw new RangeError(`Date locale invalide : ${date}`);
  return parsed;
}

export function isLocalDate(value: string): boolean {
  return LOCAL_DATE.test(value) && DateTime.fromISO(value, { zone: 'UTC' }).isValid;
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau du cabinet. */
export function localToday(zone: string, now: Date): string {
  return DateTime.fromJSDate(now, { zone }).toISODate()!;
}

/** Date locale (AAAA-MM-JJ) d'un instant, dans le fuseau du cabinet. */
export function localDateOf(instant: number, zone: string): string {
  return DateTime.fromMillis(instant, { zone }).toISODate()!;
}

export function addDays(date: string, days: number): string {
  return calendarDate(date).plus({ days }).toISODate()!;
}

/** Nombre de jours de `from` à `to` (négatif si `to` précède `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round(calendarDate(to).diff(calendarDate(from), 'days').days);
}

/** Jour ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(date: string): number {
  return calendarDate(date).weekday;
}

/** Dates locales de `from` à `to`, bornes incluses. */
export function eachLocalDate(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/**
 * Instant correspondant à une heure murale : date locale + minutes depuis minuit, dans le
 * fuseau. 1440 désigne le minuit suivant. Une heure qui n'existe pas (saut d'heure du
 * printemps) est décalée en avant, une heure ambiguë (retour à l'heure d'hiver) prend sa
 * première occurrence : comportement de Luxon, vérifié par les tests.
 */
export function wallClockToInstant(date: string, minute: number, zone: string): number {
  const day = calendarDate(date);
  if (minute === MINUTES_PER_DAY) {
    return DateTime.fromObject({ year: day.year, month: day.month, day: day.day }, { zone })
      .plus({ days: 1 })
      .toMillis();
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > MINUTES_PER_DAY) {
    throw new RangeError(`Minute invalide : ${minute}`);
  }
  return DateTime.fromObject(
    {
      year: day.year,
      month: day.month,
      day: day.day,
      hour: Math.floor(minute / 60),
      minute: minute % 60,
    },
    { zone },
  ).toMillis();
}

export type LocalDateTimeResult =
  { ok: true; instant: number } | { ok: false; code: 'INVALID' | 'NONEXISTENT' };

/**
 * Heure locale saisie (« AAAA-MM-JJTHH:mm ») → instant. Une heure inexistante dans le fuseau
 * (saut d'heure) est refusée au lieu d'être déplacée en silence.
 */
export function localDateTimeToInstant(value: string, zone: string): LocalDateTimeResult {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match || !isLocalDate(match[1]!)) return { ok: false, code: 'INVALID' };
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return { ok: false, code: 'INVALID' };
  const day = calendarDate(match[1]!);
  const result = DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour, minute },
    { zone },
  );
  if (!result.isValid) return { ok: false, code: 'INVALID' };
  if (result.hour !== hour || result.minute !== minute) return { ok: false, code: 'NONEXISTENT' };
  return { ok: true, instant: result.toMillis() };
}

/** Minutes écoulées depuis minuit local (heure murale) pour un instant. */
export function localMinuteOfDay(instant: number, zone: string): number {
  const dt = DateTime.fromMillis(instant, { zone });
  return dt.hour * 60 + dt.minute;
}
