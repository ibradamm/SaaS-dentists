import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { charges, payments, practitioners } from '../../db/schema';
import type { UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';
import { bucketOf } from '../scheduling/buckets';

/*
 * Lectures financières partagées par la page « Revenus », « À encaisser » et le tableau de
 * bord : une seule définition des revenus encaissés et du restant dû (docs/adr/0009 et 0010).
 * Chaque requête filtre explicitement par cabinet et s'exécute dans la transaction withTenant
 * de l'appelant.
 */

/** Somme de centimes lue en base (bigint, renvoyé en chaîne) : entier exact exigé. */
export function cents(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error('Somme hors limites');
  return n;
}

/** Praticiens dont les revenus sont lisibles ; null : tout le cabinet. */
export interface RevenueScope {
  practitionerIds: readonly string[] | null;
}

/**
 * Périmètre des revenus d'un compte (ADR 0009, section 10). Aujourd'hui, `finance.reports.read`
 * donne tout le cabinet. Pour limiter un jour certains praticiens à leurs propres revenus :
 * ajouter une permission `finance.reports.read_own` et renvoyer ici les praticiens liés au
 * compte ; toutes les lectures de revenus passent par ce périmètre.
 */
export function revenueScope(actor: UserActor): RevenueScope {
  authorize(actor, 'finance.reports.read');
  return { practitionerIds: null };
}

export interface RevenueFilter {
  clinicId: string;
  start: Date;
  end: Date;
  scope: RevenueScope;
  /** Praticien de l'acte ; absent : tous ceux du périmètre. */
  practitionerId?: string | null;
}

/** Paiements de la période, joints à leur acte (praticien), dans le périmètre. */
function revenueWhere(filter: RevenueFilter): SQL {
  const ids = filter.scope.practitionerIds;
  return and(
    eq(payments.clinicId, filter.clinicId),
    gte(payments.receivedAt, filter.start),
    lt(payments.receivedAt, filter.end),
    ids === null
      ? undefined
      : ids.length > 0
        ? inArray(charges.practitionerId, [...ids])
        : sql`false`,
    filter.practitionerId ? eq(charges.practitionerId, filter.practitionerId) : undefined,
  )!;
}

const chargeOfPayment = and(
  eq(charges.clinicId, payments.clinicId),
  eq(charges.id, payments.chargeId),
);
const recorded = sql`${payments.status} = 'RECORDED'`;
const voided = sql`${payments.status} = 'VOIDED'`;

/** Encaissé (paiements valides) et annulé (à part, jamais compté) sur la période. */
export async function revenueTotals(tx: Transaction, filter: RevenueFilter) {
  const [row] = await tx
    .select({
      total: sql<string>`coalesce(sum(${payments.amountCents}) filter (where ${recorded}), 0)`,
      count: sql<number>`count(*) filter (where ${recorded})::int`,
      voidedTotal: sql<string>`coalesce(sum(${payments.amountCents}) filter (where ${voided}), 0)`,
      voidedCount: sql<number>`count(*) filter (where ${voided})::int`,
    })
    .from(payments)
    .innerJoin(charges, chargeOfPayment)
    .where(revenueWhere(filter));
  return {
    totalCents: cents(row?.total),
    count: row?.count ?? 0,
    voided: { amountCents: cents(row?.voidedTotal), count: row?.voidedCount ?? 0 },
  };
}

/** Encaissé par tranche : `result[i]` pour la tranche commençant à `lower[i]`. */
export async function revenueByBucket(
  tx: Transaction,
  filter: RevenueFilter,
  lower: readonly Date[],
): Promise<{ amountCents: number; count: number }[]> {
  const bucket = bucketOf(payments.receivedAt, lower);
  const rows = await tx
    .select({
      bucket,
      total: sql<string>`sum(${payments.amountCents})`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(charges, chargeOfPayment)
    .where(and(revenueWhere(filter), recorded))
    // Par position : la même expression écrite deux fois aurait deux paramètres distincts.
    .groupBy(sql`1`);
  const result = lower.map(() => ({ amountCents: 0, count: 0 }));
  for (const row of rows) {
    const slot = result[Number(row.bucket) - 1];
    if (slot) {
      slot.amountCents = cents(row.total);
      slot.count = row.count;
    }
  }
  return result;
}

/** Encaissé par praticien de l'acte (null : sans praticien), du plus élevé au plus faible. */
export async function revenueByPractitioner(tx: Transaction, filter: RevenueFilter) {
  const rows = await tx
    .select({
      practitionerId: charges.practitionerId,
      displayName: practitioners.displayName,
      total: sql<string>`sum(${payments.amountCents})`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(charges, chargeOfPayment)
    .leftJoin(
      practitioners,
      and(
        eq(practitioners.clinicId, charges.clinicId),
        eq(practitioners.id, charges.practitionerId),
      ),
    )
    .where(and(revenueWhere(filter), recorded))
    .groupBy(charges.practitionerId, practitioners.displayName)
    .orderBy(desc(sql`sum(${payments.amountCents})`), asc(practitioners.displayName));
  return rows.map((r) => ({
    practitionerId: r.practitionerId,
    displayName: r.displayName,
    amountCents: cents(r.total),
    count: r.count,
  }));
}

/** Encaissé par moyen de paiement, du plus élevé au plus faible. */
export async function revenueByMethod(tx: Transaction, filter: RevenueFilter) {
  const rows = await tx
    .select({
      method: payments.method,
      total: sql<string>`sum(${payments.amountCents})`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .innerJoin(charges, chargeOfPayment)
    .where(and(revenueWhere(filter), recorded))
    .groupBy(payments.method)
    .orderBy(desc(sql`sum(${payments.amountCents})`), asc(payments.method));
  return rows.map((r) => ({
    method: r.method,
    amountCents: cents(r.total),
    count: r.count,
  }));
}

/** Paiements dont l'acte est dans le périmètre (condition vide pour tout le cabinet). */
export function scopedCharges(
  tx: Transaction,
  clinicId: string,
  scope: RevenueScope,
): SQL | undefined {
  const ids = scope.practitionerIds;
  if (ids === null) return undefined;
  if (ids.length === 0) return sql`false`;
  return inArray(
    payments.chargeId,
    tx
      .select({ id: charges.id })
      .from(charges)
      .where(and(eq(charges.clinicId, clinicId), inArray(charges.practitionerId, [...ids]))),
  );
}

/** Paiements valides par montant dû (sous-requête). */
export function paidByCharge(tx: Transaction, clinicId: string) {
  return tx
    .select({
      chargeId: payments.chargeId,
      paid: sql<string>`sum(${payments.amountCents})`.as('paid'),
    })
    .from(payments)
    .where(and(eq(payments.clinicId, clinicId), eq(payments.status, 'RECORDED')))
    .groupBy(payments.chargeId)
    .as('paid_by_charge');
}

/** Restant dû de tout le cabinet et nombre de patients concernés, à l'instant présent. */
export async function remainingSummary(tx: Transaction, clinicId: string) {
  const paid = paidByCharge(tx, clinicId);
  const remaining = sql`${charges.amountCents} - coalesce(${paid.paid}, 0)`;
  const [row] = await tx
    .select({
      remaining: sql<string>`coalesce(sum(${remaining}), 0)`,
      patients: sql<number>`count(distinct ${charges.patientId}) filter (where ${remaining} > 0)::int`,
    })
    .from(charges)
    .leftJoin(paid, eq(paid.chargeId, charges.id))
    .where(and(eq(charges.clinicId, clinicId), eq(charges.status, 'OPEN')));
  return { totalRemainingCents: cents(row?.remaining), patients: row?.patients ?? 0 };
}
