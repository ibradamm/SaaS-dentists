import { z } from 'zod';
import { permissionSchema, roleSchema } from './permissions';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Adresse e-mail invalide' }).max(254));

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `${PASSWORD_MIN_LENGTH} caractères minimum`)
  .max(PASSWORD_MAX_LENGTH, `${PASSWORD_MAX_LENGTH} caractères maximum`);

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Code à 6 chiffres attendu');

export const loginRequestSchema = z.object({
  email: emailSchema,
  // Pas de règle de longueur ici : un ancien mot de passe doit rester utilisable.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  clinicId: z.uuid().optional(),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * Étape d'authentification restante pour une session :
 * - MFA_PENDING : mot de passe vérifié, code TOTP attendu ;
 * - PASSWORD_CHANGE_REQUIRED : mot de passe temporaire à remplacer ;
 * - MFA_ENROLLMENT_REQUIRED : rôle exigeant la double authentification, non configurée.
 */
export const sessionRestrictionSchema = z.enum([
  'MFA_PENDING',
  'PASSWORD_CHANGE_REQUIRED',
  'MFA_ENROLLMENT_REQUIRED',
]);
export type SessionRestriction = z.infer<typeof sessionRestrictionSchema>;

export const loginResponseSchema = z.object({
  restriction: sessionRestrictionSchema.nullable(),
  csrfToken: z.string(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const mfaVerifyRequestSchema = z.object({ code: totpCodeSchema });

export const meResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    fullName: z.string(),
    mfaEnabled: z.boolean(),
  }),
  clinic: z.object({ id: z.uuid(), name: z.string() }),
  role: roleSchema,
  permissions: z.array(permissionSchema),
  restriction: sessionRestrictionSchema.nullable(),
  csrfToken: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const passwordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: newPasswordSchema,
});
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;

export const mfaSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string().startsWith('otpauth://totp/'),
});
export type MfaSetupResponse = z.infer<typeof mfaSetupResponseSchema>;

export const csrfResponseSchema = z.object({ csrfToken: z.string() });
