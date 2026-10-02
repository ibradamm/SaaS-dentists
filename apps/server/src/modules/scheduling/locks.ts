import { sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';

/**
 * Sérialise les écritures d'agenda des praticiens donnés (horaires, indisponibilités et, en
 * Phase 5, rendez-vous) jusqu'à la fin de la transaction. Les verrous sont pris dans un ordre
 * fixe pour éviter tout interblocage (docs/adr/0006, R5).
 */
export async function lockPractitioners(tx: Transaction, practitionerIds: readonly string[]) {
  for (const id of [...new Set(practitionerIds)].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${id}`}, 0))`);
  }
}
