import { describe, expect, it } from 'vitest';
import { periodBuckets } from '../../scheduling/buckets';
import { occupancyOf, ratio } from '../occupancy';

const at = (iso: string) => Date.parse(iso);
const span = (start: string, end: string) => ({ start: at(start), end: at(end) });

describe('occupation', () => {
  const open = [span('2026-09-07T07:00:00Z', '2026-09-07T10:00:00Z')];

  it('temps réservé limité au temps ouvert ; chevauchements comptés une fois', () => {
    expect(
      occupancyOf(open, [
        span('2026-09-07T07:00:00Z', '2026-09-07T07:30:00Z'),
        // Déborde de 30 min après la fermeture : seule la partie ouverte compte.
        span('2026-09-07T09:30:00Z', '2026-09-07T10:30:00Z'),
        // Entièrement hors horaires.
        span('2026-09-07T11:00:00Z', '2026-09-07T12:00:00Z'),
      ]),
    ).toEqual({ openMinutes: 180, bookedMinutes: 60 });
    expect(
      occupancyOf(open, [
        span('2026-09-07T07:00:00Z', '2026-09-07T09:00:00Z'),
        span('2026-09-07T08:00:00Z', '2026-09-07T11:00:00Z'),
      ]),
    ).toEqual({ openMinutes: 180, bookedMinutes: 180 });
    expect(occupancyOf([], open)).toEqual({ openMinutes: 0, bookedMinutes: 0 });
  });

  it('taux : null sans dénominateur, jamais une division par zéro', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
    expect(ratio(1, 4)).toBe(0.25);
  });
});

describe('tranches en heure du cabinet', () => {
  it('jours de changement d’heure : 23 h au printemps, 25 h à l’automne (Paris)', () => {
    const march = periodBuckets('Europe/Paris', { from: '2026-03-28', to: '2026-03-30' }, 'day');
    expect(march.lower.map((d) => d.toISOString())).toEqual([
      '2026-03-27T23:00:00.000Z',
      '2026-03-28T23:00:00.000Z',
      '2026-03-29T22:00:00.000Z',
    ]);
    expect(march.end.toISOString()).toBe('2026-03-30T22:00:00.000Z');
    const october = periodBuckets('Europe/Paris', { from: '2026-10-25', to: '2026-10-26' }, 'day');
    expect(october.lower[1]!.getTime() - october.lower[0]!.getTime()).toBe(25 * 3_600_000);
  });

  it('mois et semaines : minuit local du premier jour de chaque tranche', () => {
    const year = periodBuckets(
      'America/New_York',
      { from: '2026-01-01', to: '2026-12-31' },
      'month',
    );
    expect(year.starts).toHaveLength(12);
    expect(year.lower[0]!.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(year.lower[6]!.toISOString()).toBe('2026-07-01T04:00:00.000Z');
    expect(year.end.toISOString()).toBe('2027-01-01T05:00:00.000Z');
  });
});
