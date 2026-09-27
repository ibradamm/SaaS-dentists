import { z } from 'zod';
import { roleSchema } from './permissions';
import { periodError } from './periods';
import { localDateSchema } from './scheduling';

/*
 * Journal d'audit consultable (docs/adr/0011). Le catalogue des actions est fermé : le serveur
 * refuse de tracer une action absente d'ici. Les libellés sont dans audit-labels.ts (chargés
 * avec la page « Journal » seulement), complets par typage.
 */

export const AUDIT_ACTIONS = [
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.mfa_failed',
  'auth.account_locked',
  'auth.logout',
  'auth.password_changed',
  'auth.mfa_enabled',
  'user.created',
  'user.access_updated',
  'user.password_reset',
  'user.mfa_reset',
  'clinic.settings_update',
  'patient.created',
  'patient.updated',
  'patient.archived',
  'patient.restored',
  'patient.contact_added',
  'patient.contact_updated',
  'patient.contact_removed',
  'patient.medical_notes_read',
  'patient.medical_note_added',
  'import.created',
  'import.committed',
  'import.discarded',
  'import.reverted',
  'practitioner.created',
  'practitioner.updated',
  'practitioner.archived',
  'practitioner.restored',
  'appointment_type.created',
  'appointment_type.updated',
  'appointment_type.archived',
  'appointment_type.restored',
  'schedule.updated',
  'schedule.period_deleted',
  'availability_block.created',
  'availability_block.updated',
  'availability_block.deleted',
  'appointment.created',
  'appointment.updated',
  'appointment.status_changed',
  'appointment.availability_override',
  'appointment.billing_exempt',
  'charge.created',
  'charge.cancelled',
  'payment.recorded',
  'payment.voided',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const auditActionSchema = z.enum(AUDIT_ACTIONS);

export const AUDIT_ENTITY_TYPES = [
  'patient',
  'appointment',
  'charge',
  'payment',
  'practitioner',
  'appointment_type',
  'availability_block',
  'import_batch',
  'user',
  'clinic',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];
export const auditEntityTypeSchema = z.enum(AUDIT_ENTITY_TYPES);

export const AUDIT_PAGE_SIZE = 50;

export const auditLogQuerySchema = z
  .object({
    /** Jours locaux du cabinet, bornes incluses ; une année au plus. */
    from: localDateSchema,
    to: localDateSchema,
    actorId: z.uuid().optional(),
    action: auditActionSchema.optional(),
    entityType: auditEntityTypeSchema.optional(),
    entityId: z.uuid().optional(),
    /** Curseur : identifiant de la dernière entrée déjà reçue (entrées plus anciennes). */
    before: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(AUDIT_PAGE_SIZE),
  })
  .superRefine((q, ctx) => {
    const error = periodError(q.from, q.to);
    if (error) ctx.addIssue({ code: 'custom', message: error, path: ['from'] });
  });
export type AuditLogQuery = z.input<typeof auditLogQuerySchema>;

const auditValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const auditLogEntrySchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  actorType: z.enum(['USER', 'AGENT', 'SYSTEM']),
  /** Compte auteur ; null pour une action du système ou d'un compte retiré du cabinet. */
  actor: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.uuid().nullable(),
  /**
   * Libellé de l'élément concerné, selon les permissions du lecteur (le nom d'un patient
   * n'est donné qu'avec patient.read) ; patientId permet d'ouvrir la fiche.
   */
  entity: z.object({ label: z.string().nullable(), patientId: z.uuid().nullable() }).nullable(),
  /** Noms des champs modifiés et valeurs non sensibles uniquement (jamais de contenu saisi). */
  changes: z
    .record(z.string(), z.object({ from: auditValue.optional(), to: auditValue.optional() }))
    .nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogResponseSchema = z.object({
  entries: z.array(auditLogEntrySchema),
  /** À passer en `before` pour la page suivante ; null s'il n'y a plus d'entrée. */
  nextCursor: z.uuid().nullable(),
});
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;

export const auditActorsResponseSchema = z.object({
  actors: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      role: roleSchema,
      active: z.boolean(),
    }),
  ),
});
export type AuditActorsResponse = z.infer<typeof auditActorsResponseSchema>;
