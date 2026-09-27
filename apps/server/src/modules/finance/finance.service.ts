import {
  MAX_JOURNAL_PAYMENTS,
  MAX_REVENUE_DAYS,
  cancelChargeRequestSchema,
  createChargeRequestSchema,
  formatCents,
  paymentStateOf,
  recordPaymentRequestSchema,
  revenueQuerySchema,
  voidPaymentRequestSchema,
  type CancelChargeRequest,
  type Charge,
  type CreateChargeRequest,
  type PatientAccount,
  type Payment,
  type PaymentMethod,
  type PaymentsJournalResponse,
  type ReceivablesResponse,
  type RecordPaymentRequest,
  type RevenueResponse,
  type VoidPaymentRequest,
} from '@dental/shared';
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../../db/client';
import {
  appointments,
  charges,
  clinics,
  patients,
  payments,
  practitioners,
  users,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { pgErrorCode } from '../../lib/pg-errors';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';
import { periodBuckets } from '../scheduling/buckets';
import { checkRange, clinicZone, rangeInstants } from '../scheduling/queries';
import {
  cents,
  paidByCharge,
  remainingSummary,
  revenueByBucket,
  revenueByMethod,
  revenueByPractitioner,
  revenueScope,
  revenueTotals,
  scopedCharges,
} from './queries';

export type FinanceService = ReturnType<typeof createFinanceService>;

/** Erreurs levées par les déclencheurs de la base (migration 0014), traduites. */
const DATABASE_ERRORS: Record<string, () => AppError> = {
  DF001: () =>
    new AppError('AMOUNT_EXCEEDS_REMAINING', 'Le montant dépasse le restant dû de cet acte', 409),
  DF002: () =>
    new AppError('CHARGE_NOT_OPEN', 'Cet acte a été annulé : aucun paiement possible', 409),
  DF003: () =>
    new AppError(
      'CHARGE_HAS_PAYMENTS',
      'Cet acte a des paiements valides : annulez-les avant d’annuler l’acte',
      409,
    ),
  DF004: () => new AppError('CONFLICT', 'Cette donnée financière est déjà annulée', 409),
  DF005: () => new AppError('CONFLICT', 'Devise différente de celle de l’acte', 409),
};

function databaseError(error: unknown): never {
  const code = pgErrorCode(error);
  const make = code === undefined ? undefined : DATABASE_ERRORS[code];
  if (make) throw make();
  throw error;
}

const replayConflict = () =>
  new AppError(
    'CONFLICT',
    'Cette saisie a déjà été enregistrée avec d’autres valeurs. Rechargez la page.',
    409,
  );

type AuditValue = string | number | boolean | null;

/**
 * Paiements et revenus encaissés (docs/adr/0009). Montants en centimes entiers ; aucune
 * donnée financière n'est modifiée ni supprimée : on annule (motif obligatoire) et on ressaisit.
 * Les invariants (jamais plus payé que dû, transitions définitives) sont garantis par la base.
 */
export function createFinanceService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  function audit(
    tx: Transaction,
    actor: UserActor,
    action: string,
    entityType: 'charge' | 'payment',
    id: string,
    meta: RequestMeta,
    changes: Record<string, { from?: AuditValue; to?: AuditValue }>,
  ) {
    return recordAudit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      action,
      entityType,
      entityId: id,
      changes,
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  async function clinicCurrency(tx: Transaction, clinicId: string): Promise<string> {
    const [clinic] = await tx
      .select({ currency: clinics.currency })
      .from(clinics)
      .where(eq(clinics.id, clinicId));
    if (!clinic) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
    return clinic.currency;
  }

  const author = (id: string | null, fullName: string | null) =>
    id && fullName ? { id, fullName } : null;

  // --- Lecture -----------------------------------------------------------------------------

  async function readPayments(
    tx: Transaction,
    clinicId: string,
    where: SQL | undefined,
  ): Promise<Payment[]> {
    const recorder = alias(users, 'recorder');
    const voider = alias(users, 'voider');
    const rows = await tx
      .select({
        id: payments.id,
        chargeId: payments.chargeId,
        patientId: payments.patientId,
        amountCents: payments.amountCents,
        currency: payments.currency,
        method: payments.method,
        reference: payments.reference,
        status: payments.status,
        receivedAt: payments.receivedAt,
        recordedById: payments.recordedBy,
        recordedByName: recorder.fullName,
        voidedAt: payments.voidedAt,
        voidedById: payments.voidedBy,
        voidedByName: voider.fullName,
        voidReason: payments.voidReason,
      })
      .from(payments)
      .leftJoin(recorder, eq(recorder.id, payments.recordedBy))
      .leftJoin(voider, eq(voider.id, payments.voidedBy))
      .where(and(eq(payments.clinicId, clinicId), where))
      .orderBy(desc(payments.receivedAt), desc(payments.id));
    return rows.map((r) => ({
      id: r.id,
      chargeId: r.chargeId,
      patientId: r.patientId,
      amountCents: r.amountCents,
      currency: r.currency,
      method: r.method,
      reference: r.reference,
      status: r.status,
      receivedAt: r.receivedAt.toISOString(),
      recordedBy: author(r.recordedById, r.recordedByName),
      voidedAt: r.voidedAt?.toISOString() ?? null,
      voidedBy: author(r.voidedById, r.voidedByName),
      voidReason: r.voidReason,
    }));
  }

  async function readCharges(
    tx: Transaction,
    clinicId: string,
    where: SQL | undefined,
  ): Promise<Charge[]> {
    const creator = alias(users, 'creator');
    const canceller = alias(users, 'canceller');
    const rows = await tx
      .select({
        id: charges.id,
        patientId: charges.patientId,
        appointmentId: charges.appointmentId,
        appointmentStartAt: appointments.startAt,
        practitionerId: charges.practitionerId,
        label: charges.label,
        amountCents: charges.amountCents,
        currency: charges.currency,
        status: charges.status,
        createdAt: charges.createdAt,
        createdById: charges.createdBy,
        createdByName: creator.fullName,
        cancelledAt: charges.cancelledAt,
        cancelledById: charges.cancelledBy,
        cancelledByName: canceller.fullName,
        cancellationReason: charges.cancellationReason,
      })
      .from(charges)
      .leftJoin(
        appointments,
        and(
          eq(appointments.clinicId, charges.clinicId),
          eq(appointments.id, charges.appointmentId),
        ),
      )
      .leftJoin(creator, eq(creator.id, charges.createdBy))
      .leftJoin(canceller, eq(canceller.id, charges.cancelledBy))
      .where(and(eq(charges.clinicId, clinicId), where))
      .orderBy(desc(charges.createdAt), desc(charges.id));
    const ids = rows.map((r) => r.id);
    const all =
      ids.length > 0 ? await readPayments(tx, clinicId, inArray(payments.chargeId, ids)) : [];
    return rows.map((r) => {
      const own = all.filter((p) => p.chargeId === r.id);
      const paid = own
        .filter((p) => p.status === 'RECORDED')
        .reduce((sum, p) => sum + p.amountCents, 0);
      return {
        id: r.id,
        patientId: r.patientId,
        appointmentId: r.appointmentId,
        appointmentStartAt: r.appointmentStartAt?.toISOString() ?? null,
        practitionerId: r.practitionerId,
        label: r.label,
        amountCents: r.amountCents,
        paidCents: paid,
        remainingCents: r.status === 'OPEN' ? r.amountCents - paid : 0,
        paymentState: paymentStateOf(r.amountCents, paid),
        currency: r.currency,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        createdBy: author(r.createdById, r.createdByName),
        cancelledAt: r.cancelledAt?.toISOString() ?? null,
        cancelledBy: author(r.cancelledById, r.cancelledByName),
        cancellationReason: r.cancellationReason,
        payments: own,
      };
    });
  }

  async function readCharge(tx: Transaction, clinicId: string, id: string): Promise<Charge> {
    const [charge] = await readCharges(tx, clinicId, eq(charges.id, id));
    if (!charge) throw new AppError('NOT_FOUND', 'Acte introuvable', 404);
    return charge;
  }

  async function account(actor: UserActor, patientId: string): Promise<PatientAccount> {
    authorize(actor, 'payment.read');
    return withTenant(db, actor.clinicId, async (tx) => {
      const [patient] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.clinicId, actor.clinicId), eq(patients.id, patientId)));
      if (!patient) throw new AppError('NOT_FOUND', 'Patient introuvable', 404);
      const list = await readCharges(tx, actor.clinicId, eq(charges.patientId, patientId));
      const open = list.filter((c) => c.status === 'OPEN');
      const due = open.reduce((sum, c) => sum + c.amountCents, 0);
      const paid = open.reduce((sum, c) => sum + c.paidCents, 0);
      return {
        currency: await clinicCurrency(tx, actor.clinicId),
        dueCents: due,
        paidCents: paid,
        remainingCents: due - paid,
        charges: list,
      };
    });
  }

  // --- Écriture ----------------------------------------------------------------------------

  /** Insère un paiement ; null si la clé d'idempotence est déjà prise (double envoi). */
  async function insertPayment(
    tx: Transaction,
    actor: UserActor,
    meta: RequestMeta,
    values: {
      idempotencyKey: string;
      chargeId: string;
      patientId: string;
      amountCents: number;
      currency: string;
      method: PaymentMethod;
      reference: string | null;
    },
  ): Promise<string | null> {
    const [row] = await tx
      .insert(payments)
      .values({
        clinicId: actor.clinicId,
        ...values,
        reference: values.reference || null,
        receivedAt: now(),
        recordedBy: actor.userId,
      })
      .onConflictDoNothing({ target: [payments.clinicId, payments.idempotencyKey] })
      .returning({ id: payments.id })
      .catch(databaseError);
    if (!row) return null;
    // Montant et moyen tracés ; la référence (numéro de chèque…) jamais recopiée.
    await audit(tx, actor, 'payment.recorded', 'payment', row.id, meta, {
      chargeId: { to: values.chargeId },
      patientId: { to: values.patientId },
      amountCents: { to: values.amountCents },
      currency: { to: values.currency },
      method: { to: values.method },
    });
    return row.id;
  }

  async function createCharge(
    actor: UserActor,
    input: CreateChargeRequest,
    meta: RequestMeta,
  ): Promise<{ charge: Charge; replayed: boolean }> {
    authorize(actor, 'payment.write');
    const data = createChargeRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const replay = async (id: string) => {
        const charge = await readCharge(tx, actor.clinicId, id);
        // Paiement immédiat de la même saisie : retrouvé par sa clé, pas par son montant.
        const [inline] = await tx
          .select({
            chargeId: payments.chargeId,
            amountCents: payments.amountCents,
            method: payments.method,
            reference: payments.reference,
          })
          .from(payments)
          .where(
            and(
              eq(payments.clinicId, actor.clinicId),
              eq(payments.idempotencyKey, data.idempotencyKey),
            ),
          );
        const samePayment =
          data.payment === null
            ? inline === undefined
            : inline !== undefined &&
              inline.chargeId === id &&
              inline.amountCents === data.payment.amountCents &&
              inline.method === data.payment.method &&
              inline.reference === (data.payment.reference || null);
        const same =
          samePayment &&
          charge.patientId === data.patientId &&
          charge.appointmentId === data.appointmentId &&
          charge.label === data.label &&
          charge.amountCents === data.amountCents;
        if (!same) throw replayConflict();
        return { charge, replayed: true };
      };
      const byKey = () =>
        tx
          .select({ id: charges.id })
          .from(charges)
          .where(
            and(
              eq(charges.clinicId, actor.clinicId),
              eq(charges.idempotencyKey, data.idempotencyKey),
            ),
          );
      const [previous] = await byKey();
      if (previous) return replay(previous.id);

      const [patient] = await tx
        .select({ status: patients.status })
        .from(patients)
        .where(and(eq(patients.clinicId, actor.clinicId), eq(patients.id, data.patientId)));
      if (!patient) throw new AppError('NOT_FOUND', 'Patient introuvable', 404);
      if (patient.status !== 'ACTIVE') {
        throw new AppError('CONFLICT', 'Patient archivé : restaurez sa fiche avant', 409);
      }
      let practitionerId = data.practitionerId;
      if (data.appointmentId) {
        const [appointment] = await tx
          .select({
            patientId: appointments.patientId,
            practitionerId: appointments.practitionerId,
          })
          .from(appointments)
          .where(
            and(eq(appointments.clinicId, actor.clinicId), eq(appointments.id, data.appointmentId)),
          );
        if (!appointment) throw new AppError('NOT_FOUND', 'Rendez-vous introuvable', 404);
        if (appointment.patientId !== data.patientId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Ce rendez-vous est celui d’un autre patient',
            400,
          );
        }
        if (practitionerId !== null && practitionerId !== appointment.practitionerId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Le praticien doit être celui du rendez-vous',
            400,
          );
        }
        practitionerId = appointment.practitionerId;
      } else if (practitionerId !== null) {
        const [practitioner] = await tx
          .select({ status: practitioners.status })
          .from(practitioners)
          .where(
            and(eq(practitioners.clinicId, actor.clinicId), eq(practitioners.id, practitionerId)),
          );
        if (!practitioner) throw new AppError('NOT_FOUND', 'Praticien introuvable', 404);
        if (practitioner.status !== 'ACTIVE') {
          throw new AppError('CONFLICT', 'Praticien archivé', 409);
        }
      }
      if (data.payment && data.payment.amountCents > data.amountCents) {
        throw new AppError(
          'AMOUNT_EXCEEDS_REMAINING',
          'Le montant encaissé dépasse le montant dû',
          409,
        );
      }
      const currency = await clinicCurrency(tx, actor.clinicId);
      const [row] = await tx
        .insert(charges)
        .values({
          clinicId: actor.clinicId,
          patientId: data.patientId,
          appointmentId: data.appointmentId,
          practitionerId,
          label: data.label,
          amountCents: data.amountCents,
          currency,
          idempotencyKey: data.idempotencyKey,
          createdBy: actor.userId,
        })
        .onConflictDoNothing({ target: [charges.clinicId, charges.idempotencyKey] })
        .returning({ id: charges.id })
        .catch(databaseError);
      if (!row) {
        // Envoi simultané de la même saisie : l'autre transaction a créé le montant dû.
        const [other] = await byKey();
        if (!other) throw replayConflict();
        return replay(other.id);
      }
      // Le libellé (texte libre) n'est jamais recopié dans l'audit.
      await audit(tx, actor, 'charge.created', 'charge', row.id, meta, {
        patientId: { to: data.patientId },
        appointmentId: { to: data.appointmentId },
        practitionerId: { to: practitionerId },
        amountCents: { to: data.amountCents },
        currency: { to: currency },
        label: {},
      });
      if (data.payment) {
        const paymentId = await insertPayment(tx, actor, meta, {
          idempotencyKey: data.idempotencyKey,
          chargeId: row.id,
          patientId: data.patientId,
          amountCents: data.payment.amountCents,
          currency,
          method: data.payment.method,
          reference: data.payment.reference,
        });
        if (!paymentId) throw replayConflict();
      }
      return { charge: await readCharge(tx, actor.clinicId, row.id), replayed: false };
    });
  }

  async function recordPayment(
    actor: UserActor,
    input: RecordPaymentRequest,
    meta: RequestMeta,
  ): Promise<{ payment: Payment; charge: Charge; replayed: boolean }> {
    authorize(actor, 'payment.write');
    const data = recordPaymentRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const byKey = async () =>
        (
          await readPayments(tx, actor.clinicId, eq(payments.idempotencyKey, data.idempotencyKey))
        )[0];
      const replay = async (payment: Payment) => {
        if (
          payment.chargeId !== data.chargeId ||
          payment.amountCents !== data.amountCents ||
          payment.method !== data.method ||
          payment.reference !== (data.reference || null)
        ) {
          throw replayConflict();
        }
        return {
          payment,
          charge: await readCharge(tx, actor.clinicId, payment.chargeId),
          replayed: true,
        };
      };
      // Verrou du montant dû d'abord, celui que prend le déclencheur : deux envois de la même
      // saisie sont sérialisés, et le second, qui ne cherche la clé qu'après, trouve le paiement
      // du premier et le renvoie. Sans cela, le déclencheur le refuserait comme dépassement
      // avant que le conflit de clé ne soit détecté (ADR 0009, F3 et F6).
      const [charge] = await tx
        .select({
          patientId: charges.patientId,
          status: charges.status,
          amountCents: charges.amountCents,
          currency: charges.currency,
        })
        .from(charges)
        .where(and(eq(charges.clinicId, actor.clinicId), eq(charges.id, data.chargeId)))
        .for('update');
      const previous = await byKey();
      if (previous) return replay(previous);
      if (!charge) throw new AppError('NOT_FOUND', 'Acte introuvable', 404);
      if (charge.status !== 'OPEN') throw DATABASE_ERRORS.DF002!();
      // Contrôle préalable pour un message précis ; la base reste l'arbitre en cas de saisies
      // simultanées (déclencheur sous verrou, ADR 0009, F3).
      const [paidRow] = await tx
        .select({ paid: sql<string>`coalesce(sum(${payments.amountCents}), 0)` })
        .from(payments)
        .where(
          and(
            eq(payments.clinicId, actor.clinicId),
            eq(payments.chargeId, data.chargeId),
            eq(payments.status, 'RECORDED'),
          ),
        );
      const remaining = charge.amountCents - cents(paidRow?.paid);
      if (data.amountCents > remaining) {
        throw new AppError(
          'AMOUNT_EXCEEDS_REMAINING',
          `Le montant dépasse le restant dû de cet acte (${formatCents(remaining, charge.currency)})`,
          409,
        );
      }
      const id = await insertPayment(tx, actor, meta, {
        idempotencyKey: data.idempotencyKey,
        chargeId: data.chargeId,
        patientId: charge.patientId,
        amountCents: data.amountCents,
        currency: charge.currency,
        method: data.method,
        reference: data.reference,
      });
      if (!id) {
        const other = await byKey();
        if (!other) throw replayConflict();
        return replay(other);
      }
      const [payment] = await readPayments(tx, actor.clinicId, eq(payments.id, id));
      return {
        payment: payment!,
        charge: await readCharge(tx, actor.clinicId, data.chargeId),
        replayed: false,
      };
    });
  }

  async function cancelCharge(
    actor: UserActor,
    id: string,
    input: CancelChargeRequest,
    meta: RequestMeta,
  ): Promise<Charge> {
    authorize(actor, 'payment.void');
    const data = cancelChargeRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const updated = await tx
        .update(charges)
        .set({
          status: 'CANCELLED',
          cancelledAt: now(),
          cancelledBy: actor.userId,
          cancellationReason: data.reason,
        })
        .where(
          and(eq(charges.clinicId, actor.clinicId), eq(charges.id, id), eq(charges.status, 'OPEN')),
        )
        .returning({ amountCents: charges.amountCents })
        .catch(databaseError);
      if (!updated[0]) {
        await readCharge(tx, actor.clinicId, id); // 404 si inconnu
        throw DATABASE_ERRORS.DF004!();
      }
      await audit(tx, actor, 'charge.cancelled', 'charge', id, meta, {
        status: { from: 'OPEN', to: 'CANCELLED' },
        amountCents: { from: updated[0].amountCents },
        cancellationReason: {},
      });
      return readCharge(tx, actor.clinicId, id);
    });
  }

  async function voidPayment(
    actor: UserActor,
    id: string,
    input: VoidPaymentRequest,
    meta: RequestMeta,
  ): Promise<{ payment: Payment; charge: Charge }> {
    authorize(actor, 'payment.void');
    const data = voidPaymentRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const updated = await tx
        .update(payments)
        .set({
          status: 'VOIDED',
          voidedAt: now(),
          voidedBy: actor.userId,
          voidReason: data.reason,
        })
        .where(
          and(
            eq(payments.clinicId, actor.clinicId),
            eq(payments.id, id),
            eq(payments.status, 'RECORDED'),
          ),
        )
        .returning({ amountCents: payments.amountCents, chargeId: payments.chargeId })
        .catch(databaseError);
      if (!updated[0]) {
        const [existing] = await readPayments(tx, actor.clinicId, eq(payments.id, id));
        if (!existing) throw new AppError('NOT_FOUND', 'Paiement introuvable', 404);
        throw DATABASE_ERRORS.DF004!();
      }
      await audit(tx, actor, 'payment.voided', 'payment', id, meta, {
        status: { from: 'RECORDED', to: 'VOIDED' },
        amountCents: { from: updated[0].amountCents },
        voidReason: {},
      });
      const [payment] = await readPayments(tx, actor.clinicId, eq(payments.id, id));
      return {
        payment: payment!,
        charge: await readCharge(tx, actor.clinicId, updated[0].chargeId),
      };
    });
  }

  // --- Restant dû et revenus ---------------------------------------------------------------

  async function receivables(actor: UserActor): Promise<ReceivablesResponse> {
    authorize(actor, 'payment.read');
    return withTenant(db, actor.clinicId, async (tx) => {
      const paid = paidByCharge(tx, actor.clinicId);
      const rows = await tx
        .select({
          id: patients.id,
          lastName: patients.lastName,
          firstName: patients.firstName,
          remaining: sql<string>`sum(${charges.amountCents} - coalesce(${paid.paid}, 0))`,
          openCharges: sql<number>`count(*)::int`,
          oldest: sql<string>`min(${charges.createdAt})`,
        })
        .from(charges)
        .innerJoin(
          patients,
          and(eq(patients.clinicId, charges.clinicId), eq(patients.id, charges.patientId)),
        )
        .leftJoin(paid, eq(paid.chargeId, charges.id))
        .where(
          and(
            eq(charges.clinicId, actor.clinicId),
            eq(charges.status, 'OPEN'),
            sql`${charges.amountCents} > coalesce(${paid.paid}, 0)`,
          ),
        )
        .groupBy(patients.id, patients.lastName, patients.firstName)
        .orderBy(sql`min(${charges.createdAt})`, patients.lastName)
        .limit(500);
      return {
        currency: await clinicCurrency(tx, actor.clinicId),
        totalRemainingCents: (await remainingSummary(tx, actor.clinicId)).totalRemainingCents,
        patients: rows.map((r) => ({
          patient: { id: r.id, lastName: r.lastName, firstName: r.firstName },
          remainingCents: cents(r.remaining),
          openCharges: r.openCharges,
          oldestChargeAt: new Date(r.oldest).toISOString(),
        })),
      };
    });
  }

  async function revenue(
    actor: UserActor,
    query: Record<string, unknown>,
  ): Promise<RevenueResponse> {
    const scope = revenueScope(actor);
    const q = revenueQuerySchema.parse(query);
    checkRange(q.from, q.to, MAX_REVENUE_DAYS);
    return withTenant(db, actor.clinicId, async (tx) => {
      // Jours du cabinet (local-time.ts), jamais ceux du serveur ; agrégation en base.
      const days = periodBuckets(await clinicZone(tx, actor.clinicId), q, 'day');
      const filter = { clinicId: actor.clinicId, start: days.start, end: days.end, scope };
      const totals = await revenueTotals(tx, filter);
      const byDay = await revenueByBucket(tx, filter, days.lower);
      return {
        currency: await clinicCurrency(tx, actor.clinicId),
        from: q.from,
        to: q.to,
        totalCents: totals.totalCents,
        paymentsCount: totals.count,
        voided: totals.voided,
        byMethod: await revenueByMethod(tx, filter),
        byPractitioner: await revenueByPractitioner(tx, filter),
        byDay: days.starts.map((date, i) => ({ date, ...byDay[i]! })).filter((d) => d.count > 0),
        remainingCents: (await remainingSummary(tx, actor.clinicId)).totalRemainingCents,
      };
    });
  }

  async function journal(
    actor: UserActor,
    query: Record<string, unknown>,
  ): Promise<PaymentsJournalResponse> {
    const scope = revenueScope(actor);
    const q = revenueQuerySchema.parse(query);
    checkRange(q.from, q.to, MAX_REVENUE_DAYS);
    return withTenant(db, actor.clinicId, async (tx) => {
      const range = rangeInstants(await clinicZone(tx, actor.clinicId), q.from, q.to);
      const list = await readPayments(
        tx,
        actor.clinicId,
        and(
          gte(payments.receivedAt, range.start),
          lt(payments.receivedAt, range.end),
          scopedCharges(tx, actor.clinicId, scope),
        ),
      );
      const shown = list.slice(0, MAX_JOURNAL_PAYMENTS);
      const chargeIds = [...new Set(shown.map((p) => p.chargeId))];
      const details =
        chargeIds.length === 0
          ? []
          : await tx
              .select({
                id: charges.id,
                label: charges.label,
                practitionerId: charges.practitionerId,
                lastName: patients.lastName,
                firstName: patients.firstName,
              })
              .from(charges)
              .innerJoin(
                patients,
                and(eq(patients.clinicId, charges.clinicId), eq(patients.id, charges.patientId)),
              )
              .where(and(eq(charges.clinicId, actor.clinicId), inArray(charges.id, chargeIds)));
      const byId = new Map(details.map((d) => [d.id, d]));
      return {
        payments: shown.map((p) => {
          const d = byId.get(p.chargeId);
          return {
            ...p,
            patient: {
              id: p.patientId,
              lastName: d?.lastName ?? '',
              firstName: d?.firstName ?? '',
            },
            chargeLabel: d?.label ?? '',
            practitionerId: d?.practitionerId ?? null,
          };
        }),
      };
    });
  }

  return {
    account,
    createCharge,
    recordPayment,
    cancelCharge,
    voidPayment,
    receivables,
    revenue,
    journal,
  };
}
