import { sql } from 'drizzle-orm';
import { char, check, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, updatedAt } from './_columns';

export const CLINIC_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;

export const clinics = pgTable(
  'clinics',
  {
    id: primaryId(),
    name: text('name').notNull(),
    // Fuseau IANA (ex. Europe/Paris), validé par l'application.
    timezone: text('timezone').notNull(),
    locale: text('locale').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    countryCode: char('country_code', { length: 2 }).notNull(),
    status: text('status', { enum: CLINIC_STATUSES }).notNull().default('ACTIVE'),
    // Paramètres du cabinet, validés par un schéma Zod à la lecture et à l'écriture.
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('clinics_name_length', sql`char_length(${t.name}) between 1 and 200`),
    check('clinics_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('clinics_country_format', sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check('clinics_status_values', sql`${t.status} in ('ACTIVE', 'SUSPENDED')`),
  ],
);

export type Clinic = typeof clinics.$inferSelect;
