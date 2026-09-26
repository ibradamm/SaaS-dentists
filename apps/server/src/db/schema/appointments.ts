import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinicIdColumn, createdAt, primaryId, updatedAt } from './_columns';
import { clinics } from './clinics';
import { patients } from './patients';
import { appointmentTypes, practitioners } from './scheduling';

/*
 * Rendez-vous (docs/adr/0007). Les contraintes d'exclusion (anti double réservation), le
 * déclencheur de occupies_slot, les statuts initiaux et la RLS sont dans la migration
 * appointments_security, drizzle-kit ne sachant pas les exprimer.
 */

/**
 * Statuts de rendez-vous, communs à tous les cabinets. occupies_slot indique si un rendez-vous
 * dans ce statut occupe son créneau (contrainte d'exclusion) : ajouter un statut ne demande
 * qu'une ligne ici.
 */
export const appointmentStatuses = pgTable(
  'appointment_statuses',
  {
    code: text('code').primaryKey(),
    occupiesSlot: boolean('occupies_slot').notNull(),
    sortOrder: smallint('sort_order').notNull(),
  },
  (t) => [check('appointment_statuses_code_format', sql`${t.code} ~ '^[A-Z][A-Z_]*$'`)],
);

export const appointments = pgTable(
  'appointments',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    practitionerId: uuid('practitioner_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    appointmentTypeId: uuid('appointment_type_id').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    status: text('status')
      .notNull()
      .default('SCHEDULED')
      .references(() => appointmentStatuses.code),
    // Recopié du statut par un déclencheur ; jamais écrit par l'application.
    occupiesSlot: boolean('occupies_slot').notNull().default(true),
    note: text('note'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by'),
    cancellationReason: text('cancellation_reason'),
    createdBy: uuid('created_by'),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'appointments_practitioner_fk',
      columns: [t.clinicId, t.practitionerId],
      foreignColumns: [practitioners.clinicId, practitioners.id],
    }),
    foreignKey({
      name: 'appointments_patient_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'appointments_type_fk',
      columns: [t.clinicId, t.appointmentTypeId],
      foreignColumns: [appointmentTypes.clinicId, appointmentTypes.id],
    }),
    index('appointments_clinic_start_idx').on(t.clinicId, t.startAt),
    index('appointments_practitioner_start_idx').on(t.practitionerId, t.startAt),
    index('appointments_patient_start_idx').on(t.patientId, t.startAt),
    check('appointments_range', sql`${t.endAt} > ${t.startAt}`),
    check(
      'appointments_duration',
      sql`${t.endAt} - ${t.startAt} between interval '5 minutes' and interval '480 minutes'`,
    ),
    // Grille de 5 minutes (tous les fuseaux actuels ont des décalages multiples de 5 min).
    check(
      'appointments_grid',
      sql`extract(epoch from ${t.startAt})::bigint % 300 = 0 and extract(epoch from ${t.endAt})::bigint % 300 = 0`,
    ),
    check('appointments_note_length', sql`char_length(${t.note}) <= 500`),
    check('appointments_reason_length', sql`char_length(${t.cancellationReason}) <= 200`),
  ],
);

export type AppointmentStatusRow = typeof appointmentStatuses.$inferSelect;
export type AppointmentRow = typeof appointments.$inferSelect;
