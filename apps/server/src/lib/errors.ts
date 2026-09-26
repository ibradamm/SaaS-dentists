import type { ErrorCode } from '@dental/shared';

/**
 * Erreur métier ou applicative exposable au client. Le message doit être compréhensible et ne
 * jamais contenir de donnée sensible ni de détail interne.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
