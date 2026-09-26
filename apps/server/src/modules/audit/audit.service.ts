import { z } from 'zod';
import type { Transaction } from '../../db/client';
import { AUDIT_ACTOR_TYPES, auditLogs, type AuditChanges } from '../../db/schema';

const auditValue = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

export const auditEntrySchema = z.object({
  actorType: z.enum(AUDIT_ACTOR_TYPES),
  actorId: z.uuid().nullable(),
  // Forme : domaine.action (ex. appointment.cancel, clinic.settings_update)
  action: z.string().regex(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/),
  entityType: z
    .string()
    .regex(/^[a-z_]+$/)
    .nullable()
    .default(null),
  entityId: z.uuid().nullable().default(null),
  // Noms de champs et valeurs non sensibles uniquement ; le contenu médical ou les messages
  // patients n'y figurent jamais (seul le nom du champ modifié est tracé).
  changes: z
    .record(
      z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
      z.object({ from: auditValue.optional(), to: auditValue.optional() }),
    )
    .nullable()
    .default(null),
  requestId: z.string().max(100).nullable().default(null),
  ip: z.union([z.ipv4(), z.ipv6()]).nullable().default(null),
});
export type AuditEntry = z.input<typeof auditEntrySchema>;

/**
 * Enregistre une entrée d'audit dans la transaction métier en cours : l'action et sa trace
 * sont validées ou annulées ensemble. Le cabinet provient du contexte withTenant.
 */
export async function recordAudit(tx: Transaction, entry: AuditEntry): Promise<void> {
  const data = auditEntrySchema.parse(entry);
  await tx.insert(auditLogs).values({ ...data, changes: data.changes as AuditChanges | null });
}
