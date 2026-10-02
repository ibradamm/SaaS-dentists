/*
 * Périodes du tableau de bord (docs/adr/0010, section 3) : arithmétique sur des dates de
 * calendrier AAAA-MM-JJ, sans fuseau. Le passage aux instants se fait côté serveur, dans le
 * fuseau du cabinet (local-time.ts).
 */

/** Longueur maximale d'une période de statistiques : une année. */
export const MAX_STATS_DAYS = 366;

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const PERIOD_KINDS = ['day', 'week', 'month', 'year'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export interface Period {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const calendar = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addCalendarDays(date: string, days: number): string {
  return iso(calendar(date) + days * DAY_MS);
}

/** Nombre de jours de `from` à `to`, bornes incluses. */
export function daysIn(from: string, to: string): number {
  return Math.round((calendar(to) - calendar(from)) / DAY_MS) + 1;
}

/** Jour ISO : 1 = lundi … 7 = dimanche. */
function isoWeekday(date: string): number {
  return ((new Date(calendar(date)).getUTCDay() + 6) % 7) + 1;
}

/** Premier jour du mois décalé de `months` mois. */
function monthStart(date: string, months = 0): string {
  const d = new Date(calendar(date));
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

function monthEnd(date: string): string {
  return addCalendarDays(monthStart(date, 1), -1);
}

/** Période civile (jour, semaine du lundi au dimanche, mois, année) qui contient `date`. */
export function periodOf(kind: PeriodKind, date: string): Period {
  switch (kind) {
    case 'day':
      return { from: date, to: date };
    case 'week': {
      const from = addCalendarDays(date, 1 - isoWeekday(date));
      return { from, to: addCalendarDays(from, 6) };
    }
    case 'month':
      return { from: monthStart(date), to: monthEnd(date) };
    case 'year':
      return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` };
  }
}

/** Nombre de mois entiers si la période va d'un 1er du mois à une fin de mois, sinon null. */
function wholeMonths(period: Period): number | null {
  if (period.from.slice(8) !== '01' || monthEnd(period.to) !== period.to) return null;
  const [fy, fm] = period.from.split('-').map(Number) as [number, number];
  const [ty, tm] = period.to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm) + 1;
}

/**
 * Période suivante (`direction` = 1) ou précédente (-1) : des mois entiers se décalent en mois
 * (mois, trimestre, année civils) ; toute autre période, de sa longueur en jours.
 */
export function shiftPeriod(period: Period, direction: 1 | -1): Period {
  const months = wholeMonths(period);
  if (months !== null) {
    const from = monthStart(period.from, direction * months);
    return { from, to: monthEnd(monthStart(from, months - 1)) };
  }
  const length = daysIn(period.from, period.to);
  return {
    from: addCalendarDays(period.from, direction * length),
    to: addCalendarDays(period.to, direction * length),
  };
}

/** Découpage de l'évolution : jour jusqu'à 31 jours, semaine jusqu'à 183 jours, puis mois. */
export function granularityFor(period: Period): Granularity {
  const days = daysIn(period.from, period.to);
  if (days <= 31) return 'day';
  if (days <= 183) return 'week';
  return 'month';
}

/**
 * Premier jour de chaque tranche : `from`, puis chaque début de semaine (lundi) ou de mois
 * compris dans la période. La première et la dernière tranche peuvent être partielles.
 */
export function bucketStarts(period: Period, granularity: Granularity): string[] {
  const starts = [period.from];
  let next =
    granularity === 'day'
      ? addCalendarDays(period.from, 1)
      : granularity === 'week'
        ? addCalendarDays(period.from, 8 - isoWeekday(period.from))
        : monthStart(period.from, 1);
  while (next <= period.to) {
    starts.push(next);
    next =
      granularity === 'day'
        ? addCalendarDays(next, 1)
        : granularity === 'week'
          ? addCalendarDays(next, 7)
          : monthStart(next, 1);
  }
  return starts;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problème d'une période saisie (message à afficher), ou null si elle est valide. */
export function periodError(from: string, to: string, maxDays = MAX_STATS_DAYS): string | null {
  const valid = (d: string) => LOCAL_DATE.test(d) && iso(calendar(d)) === d;
  if (!valid(from) || !valid(to)) return 'Choisissez deux dates.';
  if (from > to) return 'La date de début doit précéder la date de fin.';
  if (daysIn(from, to) > maxDays) return 'Période limitée à une année.';
  return null;
}
