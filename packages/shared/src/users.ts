import { z } from 'zod';
import { emailSchema } from './auth';
import { roleSchema } from './permissions';

export const membershipStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const clinicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: roleSchema,
  status: membershipStatusSchema,
  mfaEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
});
export type ClinicUser = z.infer<typeof clinicUserSchema>;

export const listUsersResponseSchema = z.object({ users: z.array(clinicUserSchema) });

export const createUserRequestSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(1).max(200),
  role: roleSchema,
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/** Le mot de passe temporaire n'est renvoyé qu'une fois ; il doit être changé à la connexion. */
export const temporaryPasswordResponseSchema = z.object({
  user: clinicUserSchema,
  temporaryPassword: z.string(),
});
export type TemporaryPasswordResponse = z.infer<typeof temporaryPasswordResponseSchema>;

export const updateUserRequestSchema = z
  .object({ role: roleSchema.optional(), status: membershipStatusSchema.optional() })
  .refine((v) => v.role !== undefined || v.status !== undefined, 'Aucune modification demandée');
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;
