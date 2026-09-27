import { describe, expect, it } from 'vitest';
import {
  bucketStarts,
  daysIn,
  granularityFor,
  periodOf,
  shiftPeriod,
  type Period,
} from './periods';

const p = (from: string, to: string): Period => ({ from, to });

describe('périodes du tableau de bord', () => {
  it('période civile contenant une date : semaine du lundi au dimanche, mois, année', () => {
    // Dimanche 27 septembre 2026.
    expect(periodOf('day', '2026-09-27')).toEqual(p('2026-09-27', '2026-09-27'));
    expect(periodOf('week', '2026-09-27')).toEqual(p('2026-09-21', '2026-09-27'));
    expect(periodOf('week', '2026-09-28')).toEqual(p('2026-09-28', '2026-10-04'));
    expect(periodOf('month', '2026-02-10')).toEqual(p('2026-02-01', '2026-02-28'));
    expect(periodOf('month', '2028-02-10')).toEqual(p('2028-02-01', '2028-02-29'));
    expect(periodOf('year', '2026-09-27')).toEqual(p('2026-01-01', '2026-12-31'));
  });

  it('période précédente et suivante : mois entiers en mois, sinon même longueur', () => {
    expect(shiftPeriod(p('2026-03-01', '2026-03-31'), -1)).toEqual(p('2026-02-01', '2026-02-28'));
    expect(shiftPeriod(p('2026-01-01', '2026-01-31'), -1)).toEqual(p('2025-12-01', '2025-12-31'));
    expect(shiftPeriod(p('2026-12-01', '2026-12-31'), 1)).toEqual(p('2027-01-01', '2027-01-31'));
    expect(shiftPeriod(p('2026-01-01', '2026-12-31'), -1)).toEqual(p('2025-01-01', '2025-12-31'));
    // Trimestre : trois mois entiers.
    expect(shiftPeriod(p('2026-01-01', '2026-03-31'), -1)).toEqual(p('2025-10-01', '2025-12-31'));
    expect(shiftPeriod(p('2026-09-28', '2026-10-04'), -1)).toEqual(p('2026-09-21', '2026-09-27'));
    expect(shiftPeriod(p('2026-09-27', '2026-09-27'), -1)).toEqual(p('2026-09-26', '2026-09-26'));
    // Période libre qui n'est pas en mois entiers : même nombre de jours juste avant.
    expect(shiftPeriod(p('2026-03-01', '2026-03-15'), -1)).toEqual(p('2026-02-14', '2026-02-28'));
    expect(shiftPeriod(p('2026-03-02', '2026-03-31'), -1)).toEqual(p('2026-01-31', '2026-03-01'));
  });

  it('découpage : jour jusqu’à 31 jours, semaine jusqu’à 183, puis mois', () => {
    expect(granularityFor(p('2026-01-01', '2026-01-31'))).toBe('day');
    expect(granularityFor(p('2026-01-01', '2026-02-01'))).toBe('week');
    expect(daysIn('2026-01-01', '2026-07-02')).toBe(183);
    expect(granularityFor(p('2026-01-01', '2026-07-02'))).toBe('week');
    expect(granularityFor(p('2026-01-01', '2026-07-03'))).toBe('month');
    expect(granularityFor(p('2026-01-01', '2026-12-31'))).toBe('month');
  });

  it('tranches : jours, semaines du lundi (bords partiels), mois', () => {
    expect(bucketStarts(p('2026-09-28', '2026-10-01'), 'day')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
    // Du jeudi 1er octobre au mercredi 21 : semaine partielle, deux lundis, fin partielle.
    expect(bucketStarts(p('2026-10-01', '2026-10-21'), 'week')).toEqual([
      '2026-10-01',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
    expect(bucketStarts(p('2026-01-15', '2026-04-10'), 'month')).toEqual([
      '2026-01-15',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ]);
    expect(bucketStarts(p('2026-01-01', '2026-12-31'), 'month')).toHaveLength(12);
    expect(bucketStarts(p('2026-09-27', '2026-09-27'), 'day')).toEqual(['2026-09-27']);
  });
});
