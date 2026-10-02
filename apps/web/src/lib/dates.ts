/*
 * Dates et heures affichées dans le fuseau du cabinet, jamais dans celui du poste : une
 * secrétaire en déplacement voit le même agenda que le cabinet. Les dates locales sont des
 * chaînes AAAA-MM-JJ, manipulées comme dates de calendrier (sans fuseau).
 */

export const WEEKDAY_LABELS = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

const DAY_MS = 86_400_000;

function calendar(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Date du jour dans le fuseau donné. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return localDateOf(now, timeZone);
}

/**
 * Date (AAAA-MM-JJ) et heure murale (HH:mm) d'un instant dans le fuseau donné : sert à
 * placer un rendez-vous sur la grille et à préremplir sa modification.
 */
export function localDateTimeOf(
  instant: string | number | Date,
  timeZone: string,
): { date: string; time: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  const [hour, minute] = [get('hour'), get('minute')];
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${minute}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
}

/** « HH:mm » pour un nombre de minutes depuis minuit. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Date locale (AAAA-MM-JJ) d'un instant dans le fuseau donné. */
export function localDateOf(instant: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

export function addDays(date: string, days: number): string {
  return new Date(calendar(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Jour ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(date: string): number {
  return ((calendar(date).getUTCDay() + 6) % 7) + 1;
}

/** Lundi de la semaine de la date. */
export function startOfWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Heure locale « HH:mm » d'un instant dans le fuseau du cabinet. */
export function formatTime(instant: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
}

/** « lundi 28 septembre » pour une date locale. */
export function formatDayLabel(date: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(calendar(date));
}

/** « 28/09/2026 » pour une date locale. */
export function formatLocalDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/** Fuseaux IANA proposés (liste du navigateur ; le serveur valide). */
export function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Europe/Paris'];
  }
}

/** Âge en années révolues à la date `today` (dates locales AAAA-MM-JJ). */
export function ageOn(birthDate: string, today: string): number {
  const [by = 0, bm = 0, bd = 0] = birthDate.split('-').map(Number);
  const [ty = 0, tm = 0, td = 0] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
