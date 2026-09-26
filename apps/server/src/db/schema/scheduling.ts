import { BLOCK_KINDS } from '@dental/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { clinicIdColumn, createdAt, primaryId, updatedAt } from './_columns';
import { clinicMemberships } from './clinic-memberships';
import { clinics } from './clinics';

/*
 * Praticiens, types de rendez-vous, horaires et indisponibilités (docs/adr/0006). Les
 * contraintes d'exclusion (pas de chevauchement) et la RLS sont dans la migration
 * scheduling_security, drizzle-kit ne sachant pas les exprimer.
 */

export const RECORD_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

/** Ressource réservable, liée ou non à un compte membre du cabinet. */
export const practitioners = pgTable(
  'practitioners',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    displayName: text('display_name').notNull(),
    // Compte lié : doit être membre de ce cabinet (clé composite vers clinic_memberships).
    userId: uuid('user_id'),
    color: text('color').notNull(),
    status: text('status', { enum: RECORD_STATUSES }).notNull().default('ACTIVE'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('practitioners_clinic_id_key').on(t.clinicId, t.id),
    uniqueIndex('practitioners_clinic_user_key')
      .on(t.clinicId, t.userId)
      .where(sql`${t.userId} is not null`),
    foreignKey({
      name: 'practitioners_membership_fk',
      columns: [t.clinicId, t.userId],
      foreignColumns: [clinicMemberships.clinicId, clinicMemberships.userId],
    }),
    check(
      'practitioners_display_name_length',
      sql`char_length(${t.displayName}) between 1 and 100`,
    ),
    check('practitioners_color_format', sql`${t.color} ~ '^#[0-9a-f]{6}$'`),
    check('practitioners_status_values', sql`${t.status} in ('ACTIVE', 'ARCHIVED')`),
  ],
);

export const appointmentTypes = pgTable(
  'appointment_types',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    name: text('name').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    color: text('color').notNull(),
    status: text('status', { enum: RECORD_STATUSES }).notNull().default('ACTIVE'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('appointment_types_clinic_id_key').on(t.clinicId, t.id),
    // Un nom par type actif (sans tenir compte de la casse).
    uniqueIndex('appointment_types_active_name_key')
      .on(t.clinicId, sql`lower(${t.name})`)
      .where(sql`${t.status} = 'ACTIVE'`),
    check('appointment_types_name_length', sql`char_length(${t.name}) between 1 and 100`),
    check(
      'appointment_types_duration_range',
      sql`${t.durationMinutes} between 5 and 480 and ${t.durationMinutes} % 5 = 0`,
    ),
    check('appointment_types_color_format', sql`${t.color} ~ '^#[0-9a-f]{6}$'`),
    check('appointment_types_status_values', sql`${t.status} in ('ACTIVE', 'ARCHIVED')`),
  ],
);

/** Période d'horaires d'un praticien : de valid_from inclus à valid_to exclu (null = sans fin). */
export const workingSchedules = pgTable(
  'working_schedules',
  {
    id: primaryId(),
    clinicId: clinicIdColumn(),
    practitionerId: uuid('practitioner_id').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('working_schedules_clinic_id_key').on(t.clinicId, t.id),
    foreignKey({
      name: 'working_schedules_practitioner_fk',
      columns: [t.clinicId, t.practitionerId],
      foreignColumns: [practitioners.clinicId, practitioners.id],
    }),
    index('working_schedules_practitioner_idx').on(t.practitionerId, t.validFrom),
    check(
      'working_schedules_valid_range',
      sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`,
    ),
  ],
);

/** Plage d'une période : jour ISO (1 = lundi) et minutes locales depuis minuit, grille de 5 min. */
export const workingIntervals = pgTable(
  'working_intervals',
  {
    id: primaryId(),
    clinicId: clinicIdColumn(),
    scheduleId: uuid('schedule_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startMinute: smallint('start_minute').notNull(),
    endMinute: smallint('end_minute').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'working_intervals_schedule_fk',
      columns: [t.clinicId, t.scheduleId],
      foreignColumns: [workingSchedules.clinicId, workingSchedules.id],
    }).onDelete('cascade'),
    index('working_intervals_schedule_idx').on(t.scheduleId),
    check('working_intervals_weekday_range', sql`${t.weekday} between 1 and 7`),
    check(
      'working_intervals_minutes_range',
      sql`${t.startMinute} >= 0 and ${t.startMinute} < ${t.endMinute} and ${t.endMinute} <= 1440`,
    ),
    check(
      'working_intervals_minutes_grid',
      sql`${t.startMinute} % 5 = 0 and ${t.endMinute} % 5 = 0`,
    ),
  ],
);

/**
 * Indisponibilité ponctuelle [start_at, end_at) : absence (le praticien ne travaille pas) ou
 * blocage (présent mais non réservable). practitioner_id vide : tout le cabinet.
 */
export const availabilityBlocks = pgTable(
  'availability_blocks',
  {
    id: primaryId(),
    clinicId: clinicIdColumn(),
    practitionerId: uuid('practitioner_id'),
    kind: text('kind', { enum: BLOCK_KINDS }).notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    // Saisie en journées entières (minuit local à minuit local), pour l'affichage.
    allDay: boolean('all_day').notNull().default(false),
    label: text('label'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'availability_blocks_practitioner_fk',
      columns: [t.clinicId, t.practitionerId],
      foreignColumns: [practitioners.clinicId, practitioners.id],
    }),
    index('availability_blocks_clinic_start_idx').on(t.clinicId, t.startAt),
    index('availability_blocks_practitioner_start_idx').on(t.practitionerId, t.startAt),
    check('availability_blocks_kind_values', sql`${t.kind} in ('ABSENCE', 'BLOCK')`),
    check('availability_blocks_range', sql`${t.endAt} > ${t.startAt}`),
    check(
      'availability_blocks_max_duration',
      sql`${t.endAt} - ${t.startAt} <= interval '366 days'`,
    ),
    check('availability_blocks_label_length', sql`char_length(${t.label}) <= 100`),
  ],
);

export type Practitioner = typeof practitioners.$inferSelect;
export type AppointmentTypeRow = typeof appointmentTypes.$inferSelect;
export type WorkingSchedule = typeof workingSchedules.$inferSelect;
export type WorkingInterval = typeof workingIntervals.$inferSelect;
export type AvailabilityBlockRow = typeof availabilityBlocks.$inferSelect;
