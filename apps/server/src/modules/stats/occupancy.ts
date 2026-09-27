import { intersect, normalize, type Interval } from '../scheduling/intervals';

const MINUTE = 60_000;

const minutes = (list: readonly Interval[]) =>
  Math.round(normalize(list).reduce((sum, i) => sum + (i.end - i.start), 0) / MINUTE);

/**
 * Occupation d'un agenda (docs/adr/0010, section 4) : temps ouvert (horaires moins
 * indisponibilités) et temps réservé **dans** ce temps ouvert. Un rendez-vous hors horaires ne
 * compte pas, deux rendez-vous qui se chevauchent ne comptent qu'une fois : jamais plus de 100 %.
 */
export function occupancyOf(open: readonly Interval[], booked: readonly Interval[]) {
  return {
    openMinutes: minutes(open),
    bookedMinutes: minutes(intersect(open, booked)),
  };
}

/** Fraction `part / whole`, ou null si `whole` est nul : « aucune donnée », jamais 0 %. */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}
