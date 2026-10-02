import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from './client';

const clinicIdSchema = z.uuid();

/**
 * Variables de contexte lues par les politiques RLS (fonctions du schéma `app`).
 * Chacune est locale à la transaction : elle disparaît au commit ou au rollback.
 */
export interface DbContext {
  clinicId?: string | undefined;
  userId?: string | undefined;
  authEmail?: string | undefined;
  sessionTokenHash?: string | undefined;
}

const contextSchema = z.object({
  clinicId: z.uuid().optional(),
  userId: z.uuid().optional(),
  authEmail: z.string().min(1).max(254).optional(),
  sessionTokenHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

const SETTINGS: Record<keyof DbContext, string> = {
  clinicId: 'app.clinic_id',
  userId: 'app.user_id',
  authEmail: 'app.auth_email',
  sessionTokenHash: 'app.session_token_hash',
};

/** Positionne des variables de contexte dans la transaction courante. */
export async function setDbContext(tx: Transaction, context: DbContext): Promise<void> {
  const parsed = contextSchema.parse(context);
  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) continue;
    await tx.execute(sql`SELECT set_config(${SETTINGS[key as keyof DbContext]}, ${value}, true)`);
  }
}

export async function withDbContext<T>(
  db: Database,
  context: DbContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const parsed = contextSchema.parse(context);
  return db.transaction(async (tx) => {
    await setDbContext(tx, parsed);
    return fn(tx);
  });
}

/**
 * Exécute `fn` dans une transaction liée à un cabinet. Toutes les requêtes métier passent par
 * cette fonction : la RLS PostgreSQL n'expose alors que les lignes de ce cabinet, et le
 * paramètre disparaît à la fin de la transaction (set_config local), même si la connexion est
 * réutilisée par une autre requête.
 */
export async function withTenant<T>(
  db: Database,
  clinicId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withDbContext(db, { clinicId: clinicIdSchema.parse(clinicId) }, fn);
}
