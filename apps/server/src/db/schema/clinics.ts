import { sql } from 'drizzle-orm';
import { char, check, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
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
    // Conservation pour litige (docs/adr/0014) : tant qu'elle est posée, aucune suppression
    // (purge nocturne, purge après résiliation) ne touche les données du cabinet.
    legalHoldSince: timestamp('legal_hold_since', { withTimezone: true }),
    // Paramètres du cabinet, validés par un schéma Zod à la lecture et à l'écriture.
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    // Coordonnées (facultatives) ; téléphone au format E.164.
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    postalCode: text('postal_code'),
    city: text('city'),
    phone: text('phone'),
    email: text('email'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('clinics_name_length', sql`char_length(${t.name}) between 1 and 200`),
    check('clinics_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('clinics_country_format', sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    check('clinics_status_values', sql`${t.status} in ('ACTIVE', 'SUSPENDED')`),
    check(
      'clinics_address_lengths',
      sql`coalesce(char_length(${t.addressLine1}), 0) <= 200 and coalesce(char_length(${t.addressLine2}), 0) <= 200 and coalesce(char_length(${t.postalCode}), 0) <= 20 and coalesce(char_length(${t.city}), 0) <= 100`,
    ),
    check('clinics_phone_format', sql`${t.phone} is null or ${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('clinics_email_format', sql`${t.email} is null or ${t.email} ~ '^[^@\\s]+@[^@\\s]+$'`),
  ],
);

export type Clinic = typeof clinics.$inferSelect;
