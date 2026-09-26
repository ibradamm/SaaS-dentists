import { describe, expect, it } from 'vitest';
import { assignLanes, gridBounds, minuteAt, segmentOn } from './layout';

describe('placement sur la grille de l’agenda', () => {
  it('segment d’un jour en heure murale du cabinet, borné au jour', () => {
    expect(
      segmentOn(
        '2026-09-28T07:00:00.000Z',
        '2026-09-28T07:30:00.000Z',
        '2026-09-28',
        'Europe/Paris',
      ),
    ).toEqual({ start: 540, end: 570 });
    // Même instant vu d'un cabinet de New York : 3 h du matin.
    expect(
      segmentOn(
        '2026-09-28T07:00:00.000Z',
        '2026-09-28T07:30:00.000Z',
        '2026-09-28',
        'America/New_York',
      ),
    ).toEqual({ start: 180, end: 210 });
    // Absence de plusieurs jours : journée entière au milieu, rien le lendemain de la fin.
    const absence = ['2026-09-27T22:00:00.000Z', '2026-09-29T22:00:00.000Z'] as const;
    expect(segmentOn(...absence, '2026-09-28', 'Europe/Paris')).toEqual({ start: 0, end: 1440 });
    expect(segmentOn(...absence, '2026-09-29', 'Europe/Paris')).toEqual({ start: 0, end: 1440 });
    expect(segmentOn(...absence, '2026-09-30', 'Europe/Paris')).toBeNull();
    // Lendemain du passage à l'heure d'hiver : 9 h reste 9 h sur la grille.
    expect(
      segmentOn(
        '2026-10-26T08:00:00.000Z',
        '2026-10-26T08:30:00.000Z',
        '2026-10-26',
        'Europe/Paris',
      ),
    ).toEqual({ start: 540, end: 570 });
  });

  it('heures affichées : 8 h-19 h au moins, élargies à l’heure pleine', () => {
    expect(gridBounds([])).toEqual({ start: 480, end: 1140 });
    expect(
      gridBounds([
        { start: 450, end: 600 },
        { start: 1150, end: 1195 },
      ]),
    ).toEqual({
      start: 420,
      end: 1200,
    });
  });

  it('chevauchements côte à côte, voies réutilisées, groupes indépendants', () => {
    const laned = assignLanes([
      { id: 'a', start: 540, end: 570 },
      { id: 'b', start: 555, end: 600 },
      { id: 'c', start: 570, end: 600 },
      { id: 'd', start: 600, end: 630 },
      { id: 'e', start: 600, end: 630 },
    ]);
    const byId = Object.fromEntries(laned.map((x) => [x.id, [x.lane, x.lanes]]));
    // a et b se chevauchent ; c chevauche b et reprend la voie libérée par a ; d et e (adjacents
    // au groupe précédent) forment un nouveau groupe.
    expect(byId).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 2], e: [1, 2] });
  });

  it('clic sur la grille : quart d’heure inférieur, jamais hors de la journée', () => {
    expect(minuteAt(0, 1.5, 480)).toBe(480);
    expect(minuteAt(44, 1.5, 480)).toBe(495);
    expect(minuteAt(-10, 1.5, 0)).toBe(0);
    expect(minuteAt(10_000, 1.5, 480)).toBe(1425);
  });
});
