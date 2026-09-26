/*
 * Opérations sur des intervalles d'instants [start, end) en millisecondes. Génériques : elles
 * servent aux praticiens et serviront aux salles (docs/adr/0006, section 8).
 */

export interface Interval {
  start: number;
  end: number;
}

/** Trie, retire les intervalles vides et fusionne ceux qui se chevauchent ou se touchent. */
export function normalize(list: readonly Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged.at(-1);
    if (last && current.start <= last.end) last.end = Math.max(last.end, current.end);
    else merged.push({ start: current.start, end: current.end });
  }
  return merged;
}

/** Parties de `base` non couvertes par `remove`. */
export function subtract(base: readonly Interval[], remove: readonly Interval[]): Interval[] {
  const holes = normalize(remove);
  const result: Interval[] = [];
  for (const interval of normalize(base)) {
    let cursor = interval.start;
    for (const hole of holes) {
      if (hole.end <= cursor || hole.start >= interval.end) continue;
      if (hole.start > cursor) result.push({ start: cursor, end: hole.start });
      cursor = Math.max(cursor, hole.end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
}

/** Parties communes à `a` et `b`. */
export function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const left = normalize(a);
  const right = normalize(b);
  const result: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const x = left[i]!;
    const y = right[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (end > start) result.push({ start, end });
    if (x.end < y.end) i += 1;
    else j += 1;
  }
  return result;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}
