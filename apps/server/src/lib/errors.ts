import type { ErrorCode, OverrideReason } from '@dental/shared';

/**
 * Erreur métier ou applicative exposable au client. Le message doit être compréhensible et ne
 * jamais contenir de donnée sensible ni de détail interne.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly statusCode: number,
    /** Raisons d'une confirmation exigée, transmises telles quelles au client. */
    readonly reasons?: readonly OverrideReason[],
    /** Cabinets proposés au choix (CLINIC_SELECTION_REQUIRED). */
    readonly clinics?: readonly { id: string; name: string }[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}
