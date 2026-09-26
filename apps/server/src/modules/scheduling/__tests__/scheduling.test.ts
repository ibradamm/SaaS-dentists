import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  slotStarts,
  workingIntervals,
  type SchedulePeriod,
} from '../availability';
import { intersect, normalize, subtract } from '../intervals';
import {
  addDays,
  daysBetween,
  eachLocalDate,
  isoWeekday,
  localDateOf,
  localDateTimeToInstant,
  localToday,
  wallClockToInstant,
} from '../local-time';

const PARIS = 'Europe/Paris';
const iso = (ms: number) => new Date(ms).toISOString();
const hours = (i: { start: number; end: number }) => (i.end - i.start) / 3_600_000;
const H = (h: number, m = 0) => h * 60 + m;

describe('heure locale et instants', () => {
  it('construit les heures murales en hiver (+01:00) et en été (+02:00)', () => {
    expect(iso(wallClockToInstant('2026-01-12', H(9), PARIS))).toBe('2026-01-12T08:00:00.000Z');
    expect(iso(wallClockToInstant('2026-07-13', H(9), PARIS))).toBe('2026-07-13T07:00:00.000Z');
    expect(iso(wallClockToInstant('2026-07-13', 1440, PARIS))).toBe('2026-07-13T22:00:00.000Z');
  });

  it('jours de changement d’heure : une plage de 1 h à 4 h dure 2 h au printemps, 4 h à l’automne', () => {
    const spring = {
      start: wallClockToInstant('2026-03-29', H(1), PARIS),
      end: wallClockToInstant('2026-03-29', H(4), PARIS),
    };
    const autumn = {
      start: wallClockToInstant('2026-10-25', H(1), PARIS),
      end: wallClockToInstant('2026-10-25', H(4), PARIS),
    };
    expect(hours(spring)).toBe(2);
    expect(hours(autumn)).toBe(4);
    // Minuit à minuit : 23 h puis 25 h.
    expect(
      (wallClockToInstant('2026-03-29', 1440, PARIS) - wallClockToInstant('2026-03-29', 0, PARIS)) /
        3_600_000,
    ).toBe(23);
    expect(
      (wallClockToInstant('2026-10-25', 1440, PARIS) - wallClockToInstant('2026-10-25', 0, PARIS)) /
        3_600_000,
    ).toBe(25);
  });

  it('saisie locale : heure inexistante refusée, heure ambiguë = première occurrence', () => {
    expect(localDateTimeToInstant('2026-03-29T02:30', PARIS)).toEqual({
      ok: false,
      code: 'NONEXISTENT',
    });
    const ambiguous = localDateTimeToInstant('2026-10-25T02:30', PARIS);
    expect(ambiguous.ok && iso(ambiguous.instant)).toBe('2026-10-25T00:30:00.000Z');
    const normal = localDateTimeToInstant('2026-10-01T12:00', PARIS);
    expect(normal.ok && iso(normal.instant)).toBe('2026-10-01T10:00:00.000Z');
    for (const bad of ['2026-02-30T10:00', '2026-10-01T24:00', '2026-10-01 10:00', '10:00']) {
      expect(localDateTimeToInstant(bad, PARIS)).toEqual({ ok: false, code: 'INVALID' });
    }
  });

  it('dates locales : aujourd’hui dans le fuseau du cabinet, jours ISO, parcours inclusif', () => {
    // 23 h 30 UTC le 26 = déjà le 27 à Paris.
    expect(localToday(PARIS, new Date('2026-09-26T23:30:00Z'))).toBe('2026-09-27');
    expect(localToday('America/New_York', new Date('2026-09-27T02:00:00Z'))).toBe('2026-09-26');
    expect(localDateOf(Date.parse('2026-09-26T22:30:00Z'), PARIS)).toBe('2026-09-27');
    expect(isoWeekday('2026-09-28')).toBe(1);
    expect(isoWeekday('2026-09-27')).toBe(7);
    expect(eachLocalDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysBetween('2026-09-01', '2026-10-01')).toBe(30);
  });
});

describe('intervalles', () => {
  const i = (start: number, end: number) => ({ start, end });

  it('fusionne, soustrait et intersecte', () => {
    expect(normalize([i(5, 8), i(1, 3), i(3, 4), i(7, 9), i(10, 10)])).toEqual([i(1, 4), i(5, 9)]);
    expect(subtract([i(0, 10)], [i(2, 3), i(5, 7)])).toEqual([i(0, 2), i(3, 5), i(7, 10)]);
    expect(subtract([i(0, 10)], [i(-5, 2), i(8, 20)])).toEqual([i(2, 8)]);
    expect(subtract([i(0, 10)], [i(0, 10)])).toEqual([]);
    expect(subtract([i(0, 4), i(6, 10)], [i(3, 7)])).toEqual([i(0, 3), i(7, 10)]);
    expect(intersect([i(0, 5), i(8, 12)], [i(3, 10)])).toEqual([i(3, 5), i(8, 10)]);
  });
});

describe('disponibilités', () => {
  // Lundi à vendredi 9 h-12 h et 14 h-18 h ; mercredi matin seulement.
  const weekdays = [1, 2, 4, 5].flatMap((weekday) => [
    { weekday, startMinute: H(9), endMinute: H(12) },
    { weekday, startMinute: H(14), endMinute: H(18) },
  ]);
  const standard: SchedulePeriod = {
    validFrom: '2026-01-01',
    validTo: null,
    intervals: [...weekdays, { weekday: 3, startMinute: H(9), endMinute: H(12) }],
  };

  it('plages de travail d’une semaine, sans le week-end', () => {
    const working = workingIntervals([standard], '2026-09-28', '2026-10-04', PARIS);
    expect(working).toHaveLength(9);
    expect(iso(working[0]!.start)).toBe('2026-09-28T07:00:00.000Z');
    expect(working.every((w) => localDateOf(w.start, PARIS) <= '2026-10-02')).toBe(true);
  });

  it('périodes : la fin est exclue, la nouvelle période s’applique dès son premier jour', () => {
    const periods: SchedulePeriod[] = [
      { ...standard, validTo: '2026-10-01' },
      {
        validFrom: '2026-10-01',
        validTo: null,
        intervals: [{ weekday: 4, startMinute: H(10), endMinute: H(11) }],
      },
    ];
    // Mercredi 30/09 : ancienne période ; jeudi 01/10 : nouvelle.
    const working = workingIntervals(periods, '2026-09-30', '2026-10-01', PARIS);
    expect(working.map((w) => iso(w.start))).toEqual([
      '2026-09-30T07:00:00.000Z',
      '2026-10-01T08:00:00.000Z',
    ]);
    expect(workingIntervals([], '2026-09-28', '2026-10-04', PARIS)).toEqual([]);
  });

  it('retire absences et blocages, y compris sur plusieurs jours', () => {
    const at = (date: string, minute: number) => wallClockToInstant(date, minute, PARIS);
    const { working, available } = computeAvailability({
      periods: [standard],
      from: '2026-09-28',
      to: '2026-09-30',
      zone: PARIS,
      unavailabilities: [
        // Blocage de 10 h à 11 h le lundi.
        { kind: 'BLOCK', start: at('2026-09-28', H(10)), end: at('2026-09-28', H(11)) },
        // Absence du mardi 15 h au mercredi 10 h.
        { kind: 'ABSENCE', start: at('2026-09-29', H(15)), end: at('2026-09-30', H(10)) },
      ],
    });
    expect(working).toHaveLength(5);
    expect(available.map((a) => [localDateOf(a.start, PARIS), (a.end - a.start) / 60_000])).toEqual(
      [
        ['2026-09-28', 60], // 9 h-10 h
        ['2026-09-28', 60], // 11 h-12 h
        ['2026-09-28', 240], // 14 h-18 h
        ['2026-09-29', 180], // 9 h-12 h
        ['2026-09-29', 60], // 14 h-15 h
        ['2026-09-30', 120], // 10 h-12 h
      ],
    );
  });

  it('les horaires gardent leur heure locale de part et d’autre du changement d’heure', () => {
    const working = workingIntervals([standard], '2026-10-23', '2026-10-26', PARIS);
    // Vendredi 23 (été, UTC+2) et lundi 26 (hiver, UTC+1) : 9 h locale dans les deux cas.
    expect(iso(working[0]!.start)).toBe('2026-10-23T07:00:00.000Z');
    expect(iso(working[2]!.start)).toBe('2026-10-26T08:00:00.000Z');
  });
});

describe('créneaux', () => {
  const at = (date: string, minute: number, zone = PARIS) => wallClockToInstant(date, minute, zone);
  const local = (ms: number, zone = PARIS) =>
    new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(
      ms,
    );

  it('débuts alignés sur l’horloge locale, durée entière dans la plage', () => {
    const window = { start: at('2026-09-28', H(10, 20)), end: at('2026-09-28', H(12)) };
    expect(slotStarts([window], 30, 15, PARIS).map((s) => local(s))).toEqual([
      '10:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
    ]);
    expect(slotStarts([window], 120, 15, PARIS)).toEqual([]);
  });

  it('fuseau à demi-heure (Calcutta) : alignement sur l’heure locale, pas sur UTC', () => {
    const zone = 'Asia/Kolkata';
    const window = { start: at('2026-09-28', H(9), zone), end: at('2026-09-28', H(10), zone) };
    expect(slotStarts([window], 30, 30, zone).map((s) => local(s, zone))).toEqual([
      '09:00',
      '09:30',
    ]);
  });

  it('nuit du changement d’heure (New York, 8 mars 2026) : créneaux sur l’heure locale', () => {
    const zone = 'America/New_York';
    const window = { start: at('2026-03-08', H(1), zone), end: at('2026-03-08', H(4), zone) };
    // 2 h n'existe pas : de 1 h à 4 h locale, il n'y a que 2 heures réelles.
    expect(slotStarts([window], 60, 60, zone).map((s) => local(s, zone))).toEqual([
      '01:00',
      '03:00',
    ]);
  });
});
