import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { clinicIdColumn, primaryId } from './_columns';
import { clinics } from './clinics';

export const AUDIT_ACTOR_TYPES = ['USER', 'AGENT', 'SYSTEM'] as const;

/** Valeur conservée dans `changes` : uniquement des scalaires non sensibles. */
export type AuditValue = string | number | boolean | null;
export type AuditChanges = Record<string, { from?: AuditValue; to?: AuditValue }>;

/**
 * Journal d'audit en ajout seul : le rôle applicatif n'a ni UPDATE ni DELETE sur cette table
 * (migration tenant_security).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    actorType: text('actor_type', { enum: AUDIT_ACTOR_TYPES }).notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    changes: jsonb('changes').$type<AuditChanges>(),
    requestId: text('request_id'),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_clinic_created_idx').on(t.clinicId, t.createdAt.desc()),
    index('audit_logs_clinic_entity_idx').on(t.clinicId, t.entityType, t.entityId),
    check('audit_logs_actor_type_values', sql`${t.actorType} in ('USER', 'AGENT', 'SYSTEM')`),
    check('audit_logs_action_format', sql`${t.action} ~ '^[a-z][a-z_]*(\\.[a-z][a-z_]*)+$'`),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
