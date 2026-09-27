import { bucketStarts, type Granularity, type Period } from '@dental/shared';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { addDays, wallClockToInstant } from './local-time';

/**
 * Tranches d'une période (jours, semaines, mois) en instants, bornes construites en heure murale
 * du cabinet : un jour de changement d'heure dure bien 23 ou 25 heures (docs/adr/0010).
 */
export function periodBuckets(zone: string, period: Period, granularity: Granularity) {
  const starts = bucketStarts(period, granularity);
  return {
    starts,
    /** Début de chaque tranche, dans l'ordre. */
    lower: starts.map((date) => new Date(wallClockToInstant(date, 0, zone))),
    start: new Date(wallClockToInstant(period.from, 0, zone)),
    /** Fin (exclue) de la dernière tranche : minuit local qui suit `to`. */
    end: new Date(wallClockToInstant(addDays(period.to, 1), 0, zone)),
  };
}

/**
 * Numéro de tranche (1 à n) d'un instant, calculé par PostgreSQL à partir des débuts de
 * tranche : aucune conversion de fuseau en SQL. Les instants hors période doivent être exclus
 * par la requête (0 avant la première tranche, n après la dernière).
 */
export function bucketOf(column: AnyColumn, lower: readonly Date[]): SQL<number> {
  const thresholds = `{${lower.map((d) => d.toISOString()).join(',')}}`;
  return sql<number>`width_bucket(${column}, ${thresholds}::timestamptz[])`;
}
