import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { CHARGE_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '@dental/shared';
import { clinicIdColumn, createdAt, primaryId } from './_columns';
import { appointments } from './appointments';
import { clinics } from './clinics';
import { patients } from './patients';
import { practitioners } from './scheduling';

const amountCheck = (column: unknown) => sql`${column} between 1 and 100000000`;

/**
 * Montant dû (« acte à encaisser », docs/adr/0009). Jamais modifié : seule l'annulation
 * (OPEN → CANCELLED, motif obligatoire) est permise, par droits de colonne et déclencheur.
 */
export const charges = pgTable(
  'charges',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    patientId: uuid('patient_id').notNull(),
    appointmentId: uuid('appointment_id'),
    practitionerId: uuid('practitioner_id'),
    label: text('label').notNull(),
    // Centimes entiers : 1 à 100 000 000 (1 000 000,00).
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    status: text('status', { enum: CHARGE_STATUSES }).notNull().default('OPEN'),
    idempotencyKey: uuid('idempotency_key').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by'),
    cancellationReason: text('cancellation_reason'),
  },
  (t) => [
    unique('charges_clinic_id_key').on(t.clinicId, t.id),
    // Cible de la clé composite des paiements : même montant dû, même patient.
    unique('charges_clinic_id_patient_key').on(t.clinicId, t.id, t.patientId),
    unique('charges_idempotency_key').on(t.clinicId, t.idempotencyKey),
    foreignKey({
      name: 'charges_patient_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }).onDelete('restrict'),
    // Rendez-vous facultatif, forcément celui du même patient.
    foreignKey({
      name: 'charges_appointment_fk',
      columns: [t.clinicId, t.appointmentId, t.patientId],
      foreignColumns: [appointments.clinicId, appointments.id, appointments.patientId],
    }),
    foreignKey({
      name: 'charges_practitioner_fk',
      columns: [t.clinicId, t.practitionerId],
      foreignColumns: [practitioners.clinicId, practitioners.id],
    }),
    index('charges_patient_idx').on(t.clinicId, t.patientId),
    index('charges_appointment_idx').on(t.appointmentId),
    check('charges_amount_range', amountCheck(t.amountCents)),
    check('charges_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('charges_label_length', sql`char_length(${t.label}) between 1 and 120`),
    check('charges_status_values', sql`${t.status} in ('OPEN', 'CANCELLED')`),
    check('charges_reason_length', sql`char_length(${t.cancellationReason}) between 3 and 200`),
    // Annulé si et seulement si la date, l'auteur et le motif sont renseignés.
    check(
      'charges_cancellation_consistent',
      sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} is not null and ${t.cancelledBy} is not null and ${t.cancellationReason} is not null)`,
    ),
  ],
);

/**
 * Encaissement, rattaché à un montant dû du même patient. Jamais modifié : seule l'annulation
 * (RECORDED → VOIDED, motif obligatoire) est permise. Date = instant d'enregistrement.
 */
export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    clinicId: clinicIdColumn().references(() => clinics.id),
    patientId: uuid('patient_id').notNull(),
    chargeId: uuid('charge_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull(),
    method: text('method', { enum: PAYMENT_METHODS }).notNull(),
    reference: text('reference'),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('RECORDED'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    recordedBy: uuid('recorded_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
    voidReason: text('void_reason'),
  },
  (t) => [
    unique('payments_clinic_id_key').on(t.clinicId, t.id),
    unique('payments_idempotency_key').on(t.clinicId, t.idempotencyKey),
    foreignKey({
      name: 'payments_patient_fk',
      columns: [t.clinicId, t.patientId],
      foreignColumns: [patients.clinicId, patients.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payments_charge_fk',
      columns: [t.clinicId, t.chargeId, t.patientId],
      foreignColumns: [charges.clinicId, charges.id, charges.patientId],
    }),
    index('payments_charge_idx').on(t.chargeId),
    index('payments_received_idx').on(t.clinicId, t.receivedAt),
    check('payments_amount_range', amountCheck(t.amountCents)),
    check('payments_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      'payments_method_values',
      sql`${t.method} in ('CASH', 'CARD', 'CHECK', 'TRANSFER', 'OTHER')`,
    ),
    check('payments_status_values', sql`${t.status} in ('RECORDED', 'VOIDED')`),
    check('payments_reference_length', sql`char_length(${t.reference}) <= 60`),
    check('payments_reason_length', sql`char_length(${t.voidReason}) between 3 and 200`),
    check(
      'payments_void_consistent',
      sql`(${t.status} = 'VOIDED') = (${t.voidedAt} is not null and ${t.voidedBy} is not null and ${t.voidReason} is not null)`,
    ),
  ],
);

export type ChargeRow = typeof charges.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
