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
// « Maintenant » : minuit, avant tous les créneaux testés (aucun n'est dans le passé).
const MIDNIGHT = 0;
const absence = (from: number, to: number): EvaluatedBlock => ({
  kind: 'ABSENCE',
  start: from,
  end: to,
  label: null,
});

describe('évaluation d’un créneau de rendez-vous', () => {
  it('dans les horaires, sans indisponibilité : accepté sans confirmation', () => {
    expect(evaluateSlot(slot(H(10), H(10, 30)), working, [], MIDNIGHT)).toEqual({
      absent: false,
      reasons: [],
      blocks: [],
    });
    // À cheval sur deux plages adjacentes : toujours dans les horaires.
    expect(evaluateSlot(slot(H(11, 30), H(12, 30)), working, [], MIDNIGHT)).toMatchObject({
      reasons: [],
    });
  });

  it('hors horaires, même en partie : confirmation exigée', () => {
    expect(evaluateSlot(slot(H(14), H(14, 30)), working, [], MIDNIGHT)).toMatchObject({
      reasons: ['OUTSIDE_WORKING_HOURS'],
    });
    expect(evaluateSlot(slot(H(17, 45), H(18, 15)), working, [], MIDNIGHT)).toMatchObject({
      reasons: ['OUTSIDE_WORKING_HOURS'],
    });
    expect(evaluateSlot(slot(H(8), H(9)), [], [], MIDNIGHT)).toMatchObject({
      reasons: ['OUTSIDE_WORKING_HOURS'],
    });
  });

  it('sur un blocage : confirmation exigée ; un blocage adjacent ne compte pas', () => {
    const lunchMeeting = block(H(12), H(13), 'Réunion');
    expect(evaluateSlot(slot(H(12, 30), H(13)), working, [lunchMeeting], MIDNIGHT)).toEqual({
      absent: false,
      reasons: ['ON_BLOCK'],
      blocks: [lunchMeeting],
    });
    expect(evaluateSlot(slot(H(11), H(12)), working, [lunchMeeting], MIDNIGHT)).toMatchObject({
      reasons: [],
    });
    // Les deux raisons à la fois.
    expect(
      evaluateSlot(slot(H(13, 30), H(14, 30)), working, [block(H(13), H(15))], MIDNIGHT),
    ).toMatchObject({
      reasons: ['OUTSIDE_WORKING_HOURS', 'ON_BLOCK'],
    });
  });

  it('pendant une absence : refus, même partiellement et même en dehors des horaires', () => {
    expect(
      evaluateSlot(slot(H(10), H(10, 30)), working, [absence(H(10, 15), H(11))], MIDNIGHT),
    ).toEqual({
      absent: true,
      absences: [absence(H(10, 15), H(11))],
    });
    expect(evaluateSlot(slot(H(19), H(20)), working, [absence(0, H(24))], MIDNIGHT).absent).toBe(
      true,
    );
    // L'absence l'emporte sur le blocage : aucune dérogation possible.
    expect(
      evaluateSlot(
        slot(H(10), H(11)),
        working,
        [block(H(10), H(11)), absence(H(10), H(11))],
        MIDNIGHT,
      ).absent,
    ).toBe(true);
  });

  it('début déjà passé : confirmation exigée, cumulée avec les autres raisons ; absence toujours refusée', () => {
    const now = H(10, 5);
    // Commencé il y a 5 minutes : dans le passé, même s'il n'est pas terminé.
    expect(evaluateSlot(slot(H(10), H(10, 30)), working, [], now)).toMatchObject({
      reasons: ['IN_PAST'],
    });
    // Commence à l'instant : pas dans le passé.
    expect(evaluateSlot(slot(H(10, 5), H(10, 35)), working, [], now)).toMatchObject({
      reasons: [],
    });
    expect(evaluateSlot(slot(H(8), H(8, 30)), working, [block(H(8), H(9))], now)).toMatchObject({
      reasons: ['IN_PAST', 'OUTSIDE_WORKING_HOURS', 'ON_BLOCK'],
    });
    expect(evaluateSlot(slot(H(9), H(9, 30)), working, [absence(H(9), H(10))], now).absent).toBe(
      true,
    );
  });
});
