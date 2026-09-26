import type { OverrideReason } from '@dental/shared';
import type { UnavailabilityKind } from '../scheduling/availability';
import { overlaps, subtract, type Interval } from '../scheduling/intervals';

/** Indisponibilité telle que l'évaluation d'un créneau la voit. */
export interface EvaluatedBlock extends Interval {
  kind: UnavailabilityKind;
  label: string | null;
}

export type SlotEvaluation =
  | { absent: true; absences: EvaluatedBlock[] }
  | { absent: false; reasons: OverrideReason[]; blocks: EvaluatedBlock[] };

/**
 * Situation d'un rendez-vous [start, end) par rapport à l'agenda du praticien (ADR 0007) :
 * - pendant une absence (du praticien ou du cabinet) : refus, sans dérogation ;
 * - pas entièrement dans les horaires, ou sur un blocage : confirmation explicite exigée ;
 * - sinon : accepté. Fonction pure : les chevauchements de rendez-vous relèvent de la base.
 */
export function evaluateSlot(
  slot: Interval,
  working: readonly Interval[],
  blocks: readonly EvaluatedBlock[],
): SlotEvaluation {
  const touching = blocks.filter((b) => overlaps(b, slot));
  const absences = touching.filter((b) => b.kind === 'ABSENCE');
  if (absences.length > 0) return { absent: true, absences };
  const reasons: OverrideReason[] = [];
  if (subtract([slot], working).length > 0) reasons.push('OUTSIDE_WORKING_HOURS');
  const onBlocks = touching.filter((b) => b.kind === 'BLOCK');
  if (onBlocks.length > 0) reasons.push('ON_BLOCK');
  return { absent: false, reasons, blocks: onBlocks };
}
