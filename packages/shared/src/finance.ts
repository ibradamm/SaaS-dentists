import { z } from 'zod';
import { amountCentsSchema, currencySchema } from './money';
import { localDateSchema } from './scheduling';

/*
 * Paiements et revenus encaissés (docs/adr/0009). Montant dû (« acte à encaisser ») et
 * encaissement sont deux objets distincts ; les montants sont en centimes entiers.
 */

export const PAYMENT_METHODS = ['CASH', 'CARD', 'CHECK', 'TRANSFER', 'OTHER'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const CHARGE_STATUSES = ['OPEN', 'CANCELLED'] as const;
export const chargeStatusSchema = z.enum(CHARGE_STATUSES);
export type ChargeStatus = z.infer<typeof chargeStatusSchema>;

export const PAYMENT_STATUSES = ['RECORDED', 'VOIDED'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/** État de paiement d'un montant dû : calculé, jamais stocké (ADR 0009, section 2). */
export const PAYMENT_STATES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export function paymentStateOf(amountCents: number, paidCents: number): PaymentState {
  if (paidCents <= 0) return 'UNPAID';
  return paidCents >= amountCents ? 'PAID' : 'PARTIALLY_PAID';
}

/** Fenêtre maximale d'un rapport de revenus : une année. */
export const MAX_REVENUE_DAYS = 366;
/** Journal des encaissements : au plus ce nombre de paiements, les plus récents. */
export const MAX_JOURNAL_PAYMENTS = 1000;

const idempotencyKey = z.uuid();
const labelSchema = z.string().trim().min(1, 'Libellé obligatoire').max(120);
const reasonSchema = z.string().trim().min(3, 'Motif obligatoire (3 caractères au moins)').max(200);
const referenceSchema = z.string().trim().max(60).nullable();
const author = z.object({ id: z.uuid(), fullName: z.string() }).nullable();

export const paymentSchema = z.object({
  id: z.uuid(),
  chargeId: z.uuid(),
  patientId: z.uuid(),
  amountCents: z.number().int(),
  currency: currencySchema,
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  status: paymentStatusSchema,
  receivedAt: z.string(),
  recordedBy: author,
  voidedAt: z.string().nullable(),
  voidedBy: author,
  voidReason: z.string().nullable(),
});
export type Payment = z.infer<typeof paymentSchema>;

export const chargeSchema = z.object({
  id: z.uuid(),
  patientId: z.uuid(),
  appointmentId: z.uuid().nullable(),
  appointmentStartAt: z.string().nullable(),
  practitionerId: z.uuid().nullable(),
  label: z.string(),
  amountCents: z.number().int(),
  /** Paiements valides (encaissés, non annulés). */
  paidCents: z.number().int(),
  remainingCents: z.number().int(),
  paymentState: z.enum(PAYMENT_STATES),
  currency: currencySchema,
  status: chargeStatusSchema,
  createdAt: z.string(),
  createdBy: author,
  cancelledAt: z.string().nullable(),
  cancelledBy: author,
  cancellationReason: z.string().nullable(),
  payments: z.array(paymentSchema),
});
export type Charge = z.infer<typeof chargeSchema>;

/** Compte d'un patient : totaux sur les montants dus ouverts, puis détail. */
export const patientAccountSchema = z.object({
  currency: currencySchema,
  dueCents: z.number().int(),
  paidCents: z.number().int(),
  remainingCents: z.number().int(),
  charges: z.array(chargeSchema),
});
export type PatientAccount = z.infer<typeof patientAccountSchema>;

const newPaymentFields = {
  amountCents: amountCentsSchema,
  method: paymentMethodSchema,
  reference: referenceSchema.default(null),
};

export const createChargeRequestSchema = z.object({
  /** Clé d'une saisie : un double envoi renvoie le même montant dû (ADR 0009, F6). */
  idempotencyKey,
  patientId: z.uuid(),
  appointmentId: z.uuid().nullable().default(null),
  practitionerId: z.uuid().nullable().default(null),
  label: labelSchema,
  amountCents: amountCentsSchema,
  /** Encaissement immédiat, dans la même transaction (paiement partiel ou total). */
  payment: z.object(newPaymentFields).nullable().default(null),
});
export type CreateChargeRequest = z.input<typeof createChargeRequestSchema>;

export const recordPaymentRequestSchema = z.object({
  idempotencyKey,
  chargeId: z.uuid(),
  ...newPaymentFields,
});
export type RecordPaymentRequest = z.input<typeof recordPaymentRequestSchema>;

export const cancelChargeRequestSchema = z.object({ reason: reasonSchema });
export type CancelChargeRequest = z.input<typeof cancelChargeRequestSchema>;

export const voidPaymentRequestSchema = z.object({ reason: reasonSchema });
export type VoidPaymentRequest = z.input<typeof voidPaymentRequestSchema>;

/** Résultat d'un encaissement ou d'une annulation de paiement : le paiement et son acte. */
export const paymentResultSchema = z.object({ payment: paymentSchema, charge: chargeSchema });
export type PaymentResult = z.infer<typeof paymentResultSchema>;

/** Patients qui doivent de l'argent (liste « À encaisser »). */
export const receivablesResponseSchema = z.object({
  currency: currencySchema,
  totalRemainingCents: z.number().int(),
  patients: z.array(
    z.object({
      patient: z.object({ id: z.uuid(), lastName: z.string(), firstName: z.string() }),
      remainingCents: z.number().int(),
      openCharges: z.number().int(),
      oldestChargeAt: z.string(),
    }),
  ),
});
export type ReceivablesResponse = z.infer<typeof receivablesResponseSchema>;

export const revenueQuerySchema = z.object({ from: localDateSchema, to: localDateSchema });
export type RevenueQuery = z.input<typeof revenueQuerySchema>;

const bucket = { amountCents: z.number().int(), count: z.number().int() };
export const revenueResponseSchema = z.object({
  currency: currencySchema,
  from: localDateSchema,
  to: localDateSchema,
  totalCents: z.number().int(),
  paymentsCount: z.number().int(),
  /** Paiements annulés de la période : affichés, jamais comptés. */
  voided: z.object(bucket),
  byMethod: z.array(z.object({ method: paymentMethodSchema, ...bucket })),
  byPractitioner: z.array(
    z.object({
      practitionerId: z.uuid().nullable(),
      displayName: z.string().nullable(),
      ...bucket,
    }),
  ),
  byDay: z.array(z.object({ date: localDateSchema, ...bucket })),
  /** Restant dû de tout le cabinet, à l'instant de la consultation. */
  remainingCents: z.number().int(),
});
export type RevenueResponse = z.infer<typeof revenueResponseSchema>;

/** Journal des encaissements d'une période (revenus). */
export const paymentsJournalResponseSchema = z.object({
  payments: z.array(
    paymentSchema.extend({
      patient: z.object({ id: z.uuid(), lastName: z.string(), firstName: z.string() }),
      chargeLabel: z.string(),
      practitionerId: z.uuid().nullable(),
    }),
  ),
});
export type PaymentsJournalResponse = z.infer<typeof paymentsJournalResponseSchema>;

/** Mention « sans facturation » d'un rendez-vous (rendez-vous gratuit, docs/adr/0010). */
export const billingExemptionRequestSchema = z.object({ billingExempt: z.boolean() });
export type BillingExemptionRequest = z.input<typeof billingExemptionRequestSchema>;
export const billingExemptionResponseSchema = z.object({
  appointmentId: z.uuid(),
  billingExempt: z.boolean(),
});
