/** Dates locales (AAAA-MM-JJ) dans le fuseau du cabinet, à partir de l'horloge réelle. */
export const ZONE = 'Europe/Paris';

export function todayIn(zone = ZONE, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Jour ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** Prochain jour ouvré (lundi à vendredi) strictement après `date`. */
export function nextWorkday(date: string): string {
  let d = addDays(date, 1);
  while (isoWeekday(d) > 5) d = addDays(d, 1);
  return d;
}

/** Heure locale « HH:MM » du cabinet maintenant. */
export function nowTimeIn(zone = ZONE, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

export function frDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}
