import { emailSchema, roleSchema } from '@dental/shared';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { assertAcceptableNewPassword, hashPassword } from '../../modules/auth/password';
import type { Database } from '../client';
import { clinicMemberships, sessions, users } from '../schema';
import { withDbContext } from '../tenant';

export const provisionUserInput = z.object({
  clinicId: z.uuid(),
  email: emailSchema,
  fullName: z.string().trim().min(1).max(200),
  role: roleSchema,
  password: z.string(),
  mustChangePassword: z.boolean(),
});
export type ProvisionUserInput = z.input<typeof provisionUserInput>;

/**
 * Création d'un compte et de son appartenance à un cabinet : opération d'administration
 * (premier administrateur d'un cabinet, tests), exécutée avec le rôle propriétaire.
 */
export async function provisionUser(ownerDb: Database, input: ProvisionUserInput): Promise<string> {
  const data = provisionUserInput.parse(input);
  assertAcceptableNewPassword(data.password, { email: data.email });
  const passwordHash = await hashPassword(data.password);
  const id = uuidv7();
  await withDbContext(ownerDb, { clinicId: data.clinicId }, async (tx) => {
    await tx.insert(users).values({
      id,
      email: data.email,
      fullName: data.fullName,
      passwordHash,
      mustChangePassword: data.mustChangePassword,
    });
    await tx
      .insert(clinicMemberships)
      .values({ clinicId: data.clinicId, userId: id, role: data.role });
  });
  return id;
}

/**
 * Réinitialise la double authentification d'un compte (perte du téléphone du seul
 * administrateur) et ferme ses sessions dans tous ses cabinets.
 */
export async function resetUserMfa(ownerDb: Database, email: string): Promise<boolean> {
  const normalized = emailSchema.parse(email);
  const user = await withDbContext(ownerDb, { authEmail: normalized }, async (tx) => {
    const [row] = await tx
      .update(users)
      .set({ mfaSecretEnc: null, mfaEnabledAt: null, mfaLastTimeStep: null })
      .where(eq(users.email, normalized))
      .returning({ id: users.id });
    return row;
  });
  if (!user) return false;
  const memberships = await withDbContext(ownerDb, { userId: user.id }, (tx) =>
    tx.select({ clinicId: clinicMemberships.clinicId }).from(clinicMemberships),
  );
  for (const { clinicId } of memberships) {
    await withDbContext(ownerDb, { clinicId }, (tx) =>
      tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, user.id)),
    );
  }
  return true;
}
