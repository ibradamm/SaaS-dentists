import { localDateTimeOf } from '../../lib/dates';

/*
 * Placement sur la grille de l'agenda, en heure murale du cabinet (docs/adr/0007, section 7).
 * Fonctions pures, testées sans navigateur.
 */

/** Minutes depuis minuit (heure murale du cabinet) : [start, end). */
export interface Segment {
  start: number;
  end: number;
}

const DAY_MINUTES = 24 * 60;

/** Partie d'un intervalle [startAt, endAt) tombant le jour `day`, bornée à ce jour. */
export function segmentOn(
  startAt: string,
  endAt: string,
  day: string,
  timeZone: string,
): Segment | null {
  const start = localDateTimeOf(startAt, timeZone);
  const end = localDateTimeOf(endAt, timeZone);
  if (start.date > day || end.date < day) return null;
  const segment = {
    start: start.date < day ? 0 : start.minutes,
    end: end.date > day ? DAY_MINUTES : end.minutes,
  };
  // Intervalle qui finit à minuit pile : rien ce jour-là.
  return segment.end > segment.start ? segment : null;
}

/**
 * Heures affichées : au moins `min`, élargies à l'heure pleine pour montrer tout ce qui
 * existe (un rendez-vous confirmé hors horaires reste visible).
 */
export function gridBounds(segments: Segment[], min: Segment = { start: 8 * 60, end: 19 * 60 }) {
  let { start, end } = min;
  for (const s of segments) {
    start = Math.min(start, Math.floor(s.start / 60) * 60);
    end = Math.max(end, Math.ceil(s.end / 60) * 60);
  }
  return { start, end };
}

export type Laned<T> = T & { lane: number; lanes: number };

/**
 * Côte à côte les éléments qui se chevauchent (un rendez-vous annulé ou « patient absent » et
 * celui qui l'a remplacé) : chaque groupe de chevauchements partage sa largeur en voies.
 */
export function assignLanes<T extends Segment>(items: T[]): Laned<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result: Laned<T>[] = [];
  let group: Laned<T>[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const item of group) item.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) lane = laneEnds.push(item.end) - 1;
    else laneEnds[lane] = item.end;
    const placed = { ...item, lane, lanes: 1 };
    group.push(placed);
    result.push(placed);
    groupEnd = Math.max(groupEnd, item.end);
  }
  close();
  return result;
}

/** Heure cliquée sur une colonne, arrondie au quart d'heure inférieur. */
export function minuteAt(offsetPx: number, pxPerMinute: number, gridStart: number): number {
  const raw = gridStart + offsetPx / pxPerMinute;
  return Math.max(0, Math.min(DAY_MINUTES - 15, Math.floor(raw / 15) * 15));
}
