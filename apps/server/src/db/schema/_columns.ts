import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** Identifiant UUID v7 (ordonné dans le temps), généré par l'application. */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

/**
 * Colonne clinic_id d'une table métier. La valeur par défaut est le cabinet du contexte de
 * transaction (withTenant) ; la politique RLS refuse toute autre valeur.
 */
export const clinicIdColumn = () =>
  uuid('clinic_id')
    .notNull()
    .default(sql`app.current_clinic_id()`);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** Maintenue par le trigger app.set_updated_at (migration tenant_security). */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
