import { sql } from 'drizzle-orm';
import { bigint, boolean, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, updatedAt } from './_columns';

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

/**
 * Compte de connexion, commun à la plateforme : une même personne peut appartenir à plusieurs
 * cabinets (clinic_memberships). La visibilité est limitée par RLS (migration auth_security) :
 * un compte n'est lisible que par l'e-mail en cours de connexion, par lui-même pendant la
 * connexion, ou par un cabinet dont il est membre.
 */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    // Toujours en minuscules (contrainte), unique sur la plateforme.
    email: text('email').notNull().unique('users_email_key'),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    // Désactivation au niveau plateforme ; un cabinet désactive l'appartenance, pas le compte.
    status: text('status', { enum: USER_STATUSES }).notNull().default('ACTIVE'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    // Secret TOTP chiffré (AES-256-GCM) ; renseigné dès la mise en place, actif si mfaEnabledAt.
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    // Dernier pas de temps TOTP accepté : un code ne peut pas être rejoué.
    mfaLastTimeStep: bigint('mfa_last_time_step', { mode: 'number' }),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_full_name_length', sql`char_length(${t.fullName}) between 1 and 200`),
    check('users_status_values', sql`${t.status} in ('ACTIVE', 'DISABLED')`),
    check('users_failed_login_count_positive', sql`${t.failedLoginCount} >= 0`),
  ],
);

export type User = typeof users.$inferSelect;
