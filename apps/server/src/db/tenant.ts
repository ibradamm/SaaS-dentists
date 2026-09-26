import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Transaction } from './client';

const clinicIdSchema = z.uuid();

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
  const id = clinicIdSchema.parse(clinicId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.clinic_id', ${id}, true)`);
    return fn(tx);
  });
}
