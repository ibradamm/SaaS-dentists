import { normalize, subtract, type Interval } from './intervals';
import { eachLocalDate, isoWeekday, localMinuteOfDay, wallClockToInstant } from './local-time';

/** Plage hebdomadaire en heure locale : jour ISO (1 = lundi) et minutes depuis minuit. */
export interface WeeklyInterval {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

/** Période d'horaires : de `validFrom` inclus à `validTo` exclu (null : sans fin). */
export interface SchedulePeriod {
  validFrom: string;
  validTo: string | null;
  intervals: readonly WeeklyInterval[];
}

export type UnavailabilityKind = 'ABSENCE' | 'BLOCK';

export interface Unavailability extends Interval {
  kind: UnavailabilityKind;
}

/** Période d'horaires en vigueur à une date locale. */
export function periodAt(periods: readonly SchedulePeriod[], date: string) {
  return periods.find((p) => p.validFrom <= date && (p.validTo === null || date < p.validTo));
}

/**
 * Plages de travail du praticien, en instants, pour les dates locales de `from` à `to`
 * incluses. Chaque bord est construit en heure murale dans le fuseau du cabinet.
 */
export function workingIntervals(
  periods: readonly SchedulePeriod[],
  from: string,
  to: string,
  zone: string,
): Interval[] {
  const result: Interval[] = [];
  for (const date of eachLocalDate(from, to)) {
    const period = periodAt(periods, date);
    if (!period) continue;
    const weekday = isoWeekday(date);
    for (const interval of period.intervals) {
      if (interval.weekday !== weekday) continue;
      result.push({
        start: wallClockToInstant(date, interval.startMinute, zone),
        end: wallClockToInstant(date, interval.endMinute, zone),
      });
    }
  }
  return normalize(result);
}

/**
 * Disponibilités d'un praticien : plages de travail moins toutes les indisponibilités
 * (absences et blocages, du praticien et du cabinet). Les rendez-vous seront retirés en plus
 * en Phase 5.
 */
export function computeAvailability(input: {
  periods: readonly SchedulePeriod[];
  unavailabilities: readonly Unavailability[];
  from: string;
  to: string;
  zone: string;
}): { working: Interval[]; available: Interval[] } {
  const working = workingIntervals(input.periods, input.from, input.to, input.zone);
  return { working, available: subtract(working, input.unavailabilities) };
}

const MINUTE = 60_000;

/**
 * Débuts de créneaux où `durationMinutes` tient entièrement dans une plage disponible. Les
 * débuts sont alignés sur l'horloge locale (multiples de `stepMinutes` depuis minuit local).
 */
export function slotStarts(
  available: readonly Interval[],
  durationMinutes: number,
  stepMinutes: number,
  zone: string,
): number[] {
  if (stepMinutes <= 0 || durationMinutes <= 0) throw new RangeError('Durée ou pas invalide');
  const alignUp = (instant: number): number => {
    let t = Math.ceil(instant / MINUTE) * MINUTE;
    // Réaligne après un éventuel changement d'heure (au plus quelques itérations).
    for (let i = 0; i < 4; i += 1) {
      const remainder = localMinuteOfDay(t, zone) % stepMinutes;
      if (remainder === 0) return t;
      t += (stepMinutes - remainder) * MINUTE;
    }
    return t;
  };
  const starts: number[] = [];
  for (const window of normalize(available)) {
    for (
      let t = alignUp(window.start);
      t + durationMinutes * MINUTE <= window.end;
      t = alignUp(t + stepMinutes * MINUTE)
    ) {
      starts.push(t);
    }
  }
  return starts;
}
