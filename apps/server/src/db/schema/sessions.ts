import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  inet,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinicIdColumn, createdAt, primaryId } from './_columns';
import { clinicMemberships } from './clinic-memberships';

export const SESSION_STATES = ['MFA_PENDING', 'ACTIVE'] as const;

/**
 * Session de connexion à un cabinet. Seule l'empreinte SHA-256 du jeton est stockée : une
 * fuite de la base ne permet pas d'usurper une session.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    tokenHash: text('token_hash').notNull().unique('sessions_token_hash_key'),
    clinicId: clinicIdColumn(),
    userId: uuid('user_id').notNull(),
    state: text('state', { enum: SESSION_STATES }).notNull(),
    csrfToken: text('csrf_token').notNull(),
    mfaAttempts: integer('mfa_attempts').notNull().default(0),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // Expiration absolue ; l'expiration d'inactivité se calcule depuis lastSeenAt.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    // Une session n'existe que pour une appartenance réelle (même cabinet, même compte).
    foreignKey({
      name: 'sessions_membership_fk',
      columns: [t.clinicId, t.userId],
      foreignColumns: [clinicMemberships.clinicId, clinicMemberships.userId],
    }),
    index('sessions_clinic_user_idx').on(t.clinicId, t.userId),
    check('sessions_state_values', sql`${t.state} in ('MFA_PENDING', 'ACTIVE')`),
    check('sessions_user_agent_length', sql`char_length(${t.userAgent}) <= 300`),
  ],
);

export type Session = typeof sessions.$inferSelect;
