import { ROLES } from '@dental/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { clinicIdColumn, createdAt, primaryId, updatedAt } from './_columns';
import { clinics } from './clinics';
import { users } from './users';

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'DISABLED'] as const;

/** Appartenance d'un compte à un cabinet, avec son rôle dans ce cabinet. */
export const clinicMemberships = pgTable(
  'clinic_memberships',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ROLES }).notNull(),
    status: text('status', { enum: MEMBERSHIP_STATUSES }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('clinic_memberships_clinic_user_key').on(t.clinicId, t.userId),
    index('clinic_memberships_user_idx').on(t.userId),
    check('clinic_memberships_role_values', sql`${t.role} in ('ADMIN', 'DENTIST', 'SECRETARY')`),
    check('clinic_memberships_status_values', sql`${t.status} in ('ACTIVE', 'DISABLED')`),
  ],
);

export type ClinicMembership = typeof clinicMemberships.$inferSelect;
