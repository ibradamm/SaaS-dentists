import { describe, expect, it } from 'vitest';
import { evaluateSlot, type EvaluatedBlock } from '../rules';

const H = (h: number, m = 0) => (h * 60 + m) * 60_000;
const slot = (from: number, to: number) => ({ start: from, end: to });
// Horaires : 9 h-12 h et 12 h-14 h (plages adjacentes), puis 15 h-18 h.
const working = [slot(H(9), H(12)), slot(H(12), H(14)), slot(H(15), H(18))];
const block = (from: number, to: number, label: string | null = null): EvaluatedBlock => ({
  kind: 'BLOCK',
  start: from,
  end: to,
  label,
});
const absence = (from: number, to: number): EvaluatedBlock => ({
  kind: 'ABSENCE',
  start: from,
  end: to,
  label: null,
});

describe('évaluation d’un créneau de rendez-vous', () => {
  it('dans les horaires, sans indisponibilité : accepté sans confirmation', () => {
    expect(evaluateSlot(slot(H(10), H(10, 30)), working, [])).toEqual({
      absent: false,
      reasons: [],
      blocks: [],
    });
    // À cheval sur deux plages adjacentes : toujours dans les horaires.
    expect(evaluateSlot(slot(H(11, 30), H(12, 30)), working, [])).toMatchObject({ reasons: [] });
  });

  it('hors horaires, même en partie : confirmation exigée', () => {
    expect(evaluateSlot(slot(H(14), H(14, 30)), working, [])).toMatchObject({
      reasons: ['OUTSIDE_WORKING_HOURS'],
    });
    expect(evaluateSlot(slot(H(17, 45), H(18, 15)), working, [])).toMatchObject({
      reasons: ['OUTSIDE_WORKING_HOURS'],
    });
    expect(evaluateSlot(slot(H(8), H(9)), [], [])).toMatchObject({
      reasons: ['OUTSIDE_WORKING_HOURS'],
    });
  });

  it('sur un blocage : confirmation exigée ; un blocage adjacent ne compte pas', () => {
    const lunchMeeting = block(H(12), H(13), 'Réunion');
    expect(evaluateSlot(slot(H(12, 30), H(13)), working, [lunchMeeting])).toEqual({
      absent: false,
      reasons: ['ON_BLOCK'],
      blocks: [lunchMeeting],
    });
    expect(evaluateSlot(slot(H(11), H(12)), working, [lunchMeeting])).toMatchObject({
      reasons: [],
    });
    // Les deux raisons à la fois.
    expect(evaluateSlot(slot(H(13, 30), H(14, 30)), working, [block(H(13), H(15))])).toMatchObject({
      reasons: ['OUTSIDE_WORKING_HOURS', 'ON_BLOCK'],
    });
  });

  it('pendant une absence : refus, même partiellement et même en dehors des horaires', () => {
    expect(evaluateSlot(slot(H(10), H(10, 30)), working, [absence(H(10, 15), H(11))])).toEqual({
      absent: true,
      absences: [absence(H(10, 15), H(11))],
    });
    expect(evaluateSlot(slot(H(19), H(20)), working, [absence(0, H(24))]).absent).toBe(true);
    // L'absence l'emporte sur le blocage : aucune dérogation possible.
    expect(
      evaluateSlot(slot(H(10), H(11)), working, [block(H(10), H(11)), absence(H(10), H(11))])
        .absent,
    ).toBe(true);
  });
});
