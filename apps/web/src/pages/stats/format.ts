import { daysIn, periodOf, type Granularity, type Period } from '@dental/shared';

/*
 * Libellés du tableau de bord. Les dates sont des dates de calendrier du cabinet (AAAA-MM-JJ),
 * mises en forme sans conversion de fuseau.
 */

const calendar = (date: string) => new Date(`${date}T00:00:00Z`);
const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options });
const dayMonthYear = fmt({ day: 'numeric', month: 'long', year: 'numeric' });
const dayMonth = fmt({ day: 'numeric', month: 'long' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const weekday = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = fmt({ day: 'numeric', month: 'short' });
const shortMonth = fmt({ month: 'short' });

const same = (a: Period, b: Period) => a.from === b.from && a.to === b.to;

/** « septembre 2026 », « semaine du 21 au 27 septembre 2026 », « année 2026 », etc. */
export function formatPeriod(period: Period): string {
  const { from, to } = period;
  if (from === to) return weekday.format(calendar(from));
  if (same(period, periodOf('month', from))) return monthYear.format(calendar(from));
  if (same(period, periodOf('year', from))) return `année ${from.slice(0, 4)}`;
  if (same(period, periodOf('week', from))) {
    return `semaine du ${dayMonth.format(calendar(from))} au ${dayMonthYear.format(calendar(to))}`;
  }
  return `du ${dayMonthYear.format(calendar(from))} au ${dayMonthYear.format(calendar(to))}`;
}

/** Libellé complet d'une tranche (infobulle, tableau des valeurs). */
export function bucketLabel(start: string, granularity: Granularity, period: Period): string {
  if (granularity === 'day') return weekday.format(calendar(start));
  if (granularity === 'month') return monthYear.format(calendar(start));
  // Une semaine peut être partielle au début ou à la fin de la période.
  const sunday = periodOf('week', start).to;
  const end = sunday < period.to ? sunday : period.to;
  return daysIn(start, end) === 1
    ? dayMonthYear.format(calendar(start))
    : `du ${dayMonth.format(calendar(start))} au ${dayMonthYear.format(calendar(end))}`;
}

/** Libellé court sous l'axe. */
export function tickLabel(start: string, granularity: Granularity): string {
  if (granularity === 'month') return shortMonth.format(calendar(start));
  return shortDay.format(calendar(start));
}

const percent = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });

/** Taux en pourcentage ; « — » quand il n'y a pas de donnée (jamais « 0 % » à tort). */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : percent.format(rate);
}

/** Durée en heures et minutes (« 63 h », « 1 h 45 »). */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

const integer = new Intl.NumberFormat('fr-FR');
export const formatCount = (n: number) => integer.format(n);
/** « 1 absent », « 35 absents » (pluriel français : à partir de 2). */
export const plural = (n: number, word: string) => `${formatCount(n)} ${word}${n > 1 ? 's' : ''}`;

/** Variation relative (« +12 % ») ; null si la période précédente est nulle. */
export function formatChange(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const change = (current - previous) / previous;
  const text = percent.format(Math.abs(change));
  return change === 0 ? '=' : `${change > 0 ? '+' : '−'}${text}`;
}
