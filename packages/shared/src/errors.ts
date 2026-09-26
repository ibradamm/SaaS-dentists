import { z } from 'zod';

/**
 * Codes d'erreur exposés par l'API. Le client s'appuie sur le code, jamais sur le message,
 * qui peut évoluer. Toute nouvelle erreur publique est ajoutée ici.
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'CLINIC_SELECTION_REQUIRED',
  'AUTH_STEP_REQUIRED',
  'INVALID_MFA_CODE',
  'CSRF_INVALID',
  // Rendez-vous (docs/adr/0007).
  'AVAILABILITY_CONFIRMATION_REQUIRED',
  'PRACTITIONER_ABSENT',
  'SLOT_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
