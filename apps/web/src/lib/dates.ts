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
