import {
  MAX_STATS_DAYS,
  dashboardQuerySchema,
  granularityFor,
  roleHasPermission,
  shiftPeriod,
  type ActivityStats,
  type DashboardResponse,
  type Permission,
} from '@dental/shared';
import { and, asc, desc, eq, gte, lt, ne, notExists, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import {
  appointmentTypes,
  appointments,
  charges,
  clinics,
  patients,
  practitioners,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { occupiedIntervals } from '../appointments/queries';
import type { UserActor } from '../auth/auth.types';
import { authorizeAny } from '../auth/authorize';
import {
  remainingSummary,
  revenueByBucket,
  revenueByPractitioner,
  revenueScope,
  revenueTotals,
} from '../finance/queries';
import { computeAvailability } from '../scheduling/availability';
import { bucketOf, periodBuckets } from '../scheduling/buckets';
import { readBlocks, readPeriods, rangeInstants, checkRange } from '../scheduling/queries';
import { occupancyOf, ratio } from './occupancy';

export type StatsService = ReturnType<typeof createStatsService>;

/** Permissions dont dépend au moins une section du tableau de bord. */
const DASHBOARD_PERMISSIONS: readonly Permission[] = [
  'appointment.read',
  'patient.read',
  'payment.read',
  'finance.reports.read',
];
const UPCOMING_DAYS = 7;
const TOP_TYPES = 5;
const UNBILLED_ITEMS = 10;

const status = (code: string) => sql`${appointments.status} = ${code}`;
const countWhere = (condition: SQL) => sql<number>`count(*) filter (where ${condition})::int`;

/**
 * Tableau de bord (docs/adr/0010). Tout est calculé ici, sur les données réelles, dans une
 * seule transaction ; chaque section n'est calculée que si le compte a la permission de ses
 * données sources. Comptes et sommes sont agrégés en base, par tranches dont les bornes sont
 * construites dans le fuseau du cabinet (local-time.ts).
 */
export function createStatsService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  async function dashboard(actor: UserActor, query: Record<string, unknown>) {
    authorizeAny(actor, DASHBOARD_PERMISSIONS);
    const can = (permission: Permission) => roleHasPermission(actor.role, permission);
    const q = dashboardQuerySchema.parse(query);
    checkRange(q.from, q.to, MAX_STATS_DAYS);
    const period = { from: q.from, to: q.to };
    const granularity = granularityFor(period);
    const previous = shiftPeriod(period, -1);
    const clinicId = actor.clinicId;

    return withTenant(db, clinicId, async (tx): Promise<DashboardResponse> => {
      const [clinic] = await tx
        .select({ timezone: clinics.timezone, currency: clinics.currency })
        .from(clinics)
        .where(eq(clinics.id, clinicId));
      if (!clinic) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
      const zone = clinic.timezone;
      const practitionerId = q.practitionerId ?? null;
      if (practitionerId) {
        const [found] = await tx
          .select({ id: practitioners.id })
          .from(practitioners)
          .where(and(eq(practitioners.clinicId, clinicId), eq(practitioners.id, practitionerId)));
        if (!found) throw new AppError('NOT_FOUND', 'Praticien introuvable', 404);
      }
      const buckets = periodBuckets(zone, period, granularity);
      const range = { start: buckets.start, end: buckets.end };
      const before = rangeInstants(zone, previous.from, previous.to);
      const ctx = { tx, clinicId, zone, period, range, before, buckets, practitionerId };

      return {
        from: q.from,
        to: q.to,
        previous,
        granularity,
        timezone: zone,
        currency: clinic.currency,
        practitionerId,
        ...(can('appointment.read') ? { activity: await activity(ctx) } : {}),
        ...(can('patient.read') ? { patients: await patientStats(ctx) } : {}),
        ...(can('payment.read') ? { receivables: await remainingSummary(tx, clinicId) } : {}),
        ...(can('payment.read') && can('appointment.read')
          ? { unbilled: await unbilled(ctx) }
          : {}),
        ...(can('finance.reports.read') ? { revenue: await revenue(ctx, actor) } : {}),
      };
    });
  }

  interface Context {
    tx: Transaction;
    clinicId: string;
    zone: string;
    period: { from: string; to: string };
    range: { start: Date; end: Date };
    before: { start: Date; end: Date };
    buckets: ReturnType<typeof periodBuckets>;
    practitionerId: string | null;
  }

  /** Rendez-vous du cabinet (et du praticien choisi) qui commencent dans l'intervalle. */
  const startingIn = (ctx: Context, range: { start: Date; end: Date }) =>
    and(
      eq(appointments.clinicId, ctx.clinicId),
      gte(appointments.startAt, range.start),
      lt(appointments.startAt, range.end),
      ctx.practitionerId ? eq(appointments.practitionerId, ctx.practitionerId) : undefined,
    );

  async function activity(ctx: Context): Promise<ActivityStats> {
    const { tx } = ctx;
    const bucket = bucketOf(appointments.startAt, ctx.buckets.lower);
    const rows = await tx
      .select({
        bucket,
        scheduled: countWhere(status('SCHEDULED')),
        completed: countWhere(status('COMPLETED')),
        noShow: countWhere(status('NO_SHOW')),
        cancelled: countWhere(status('CANCELLED')),
      })
      .from(appointments)
      .where(startingIn(ctx, ctx.range))
      // Par position : la même expression écrite deux fois aurait deux paramètres distincts.
      .groupBy(sql`1`);
    const series = ctx.buckets.starts.map((start) => ({
      start,
      scheduled: 0,
      completed: 0,
      noShow: 0,
      cancelled: 0,
    }));
    for (const row of rows) {
      const slot = series[Number(row.bucket) - 1];
      if (slot) {
        slot.scheduled = row.scheduled;
        slot.completed = row.completed;
        slot.noShow = row.noShow;
        slot.cancelled = row.cancelled;
      }
    }
    const sum = (key: 'scheduled' | 'completed' | 'noShow' | 'cancelled') =>
      series.reduce((s, b) => s + b[key], 0);
    const [scheduled, completed, noShow, cancelled] = [
      sum('scheduled'),
      sum('completed'),
      sum('noShow'),
      sum('cancelled'),
    ];
    const total = scheduled + completed + noShow;

    // Patients vus (distincts) et honorés de la période précédente, qui la jouxte.
    const [seen] = await tx
      .select({
        patientsSeen: sql<number>`count(distinct ${appointments.patientId}) filter (where ${status('COMPLETED')} and ${appointments.startAt} >= ${ctx.range.start})::int`,
        previousCompleted: countWhere(
          sql`${status('COMPLETED')} and ${appointments.startAt} < ${ctx.before.end}`,
        ),
      })
      .from(appointments)
      .where(startingIn(ctx, { start: ctx.before.start, end: ctx.range.end }));

    const current = now();
    const [upcoming] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(
        and(
          startingIn(ctx, {
            start: current,
            end: new Date(current.getTime() + UPCOMING_DAYS * 86_400_000),
          }),
          eq(appointments.status, 'SCHEDULED'),
        ),
      );

    const types = await tx
      .select({
        appointmentTypeId: appointments.appointmentTypeId,
        name: appointmentTypes.name,
        color: appointmentTypes.color,
        count: sql<number>`count(*)::int`,
      })
      .from(appointments)
      .innerJoin(
        appointmentTypes,
        and(
          eq(appointmentTypes.clinicId, appointments.clinicId),
          eq(appointmentTypes.id, appointments.appointmentTypeId),
        ),
      )
      .where(and(startingIn(ctx, ctx.range), ne(appointments.status, 'CANCELLED')))
      .groupBy(appointments.appointmentTypeId, appointmentTypes.name, appointmentTypes.color)
      .orderBy(desc(sql`count(*)`), asc(appointmentTypes.name))
      .limit(TOP_TYPES);

    const perPractitioner = await tx
      .select({
        practitionerId: appointments.practitionerId,
        completed: countWhere(status('COMPLETED')),
        noShow: countWhere(status('NO_SHOW')),
        cancelled: countWhere(status('CANCELLED')),
        total: countWhere(sql`${appointments.status} <> 'CANCELLED'`),
      })
      .from(appointments)
      .where(startingIn(ctx, ctx.range))
      .groupBy(appointments.practitionerId);

    // Occupation : praticiens actifs, plus tout praticien qui a des rendez-vous sur la période.
    const roster = await tx
      .select({
        id: practitioners.id,
        displayName: practitioners.displayName,
        color: practitioners.color,
        status: practitioners.status,
      })
      .from(practitioners)
      .where(
        and(
          eq(practitioners.clinicId, ctx.clinicId),
          ctx.practitionerId ? eq(practitioners.id, ctx.practitionerId) : undefined,
        ),
      )
      .orderBy(asc(practitioners.displayName), asc(practitioners.id));
    const counted = new Map(perPractitioner.map((p) => [p.practitionerId, p]));
    const shown = roster.filter(
      (p) => p.status === 'ACTIVE' || counted.has(p.id) || ctx.practitionerId === p.id,
    );
    const ids = shown.map((p) => p.id);
    const periods = await readPeriods(tx, ctx.clinicId, ids, ctx.period);
    const blocks = await readBlocks(tx, ctx.clinicId, ctx.range, ids);
    const booked = await occupiedIntervals(tx, ctx.clinicId, ids, ctx.range);
    const byPractitioner = shown.map((p) => {
      const { available } = computeAvailability({
        periods: periods
          .filter((s) => s.practitionerId === p.id)
          .map((s) => ({ validFrom: s.validFrom, validTo: s.validTo, intervals: s.intervals })),
        unavailabilities: blocks
          .filter((b) => b.practitionerId === null || b.practitionerId === p.id)
          .map((b) => ({ kind: b.kind, start: b.startAt.getTime(), end: b.endAt.getTime() })),
        from: ctx.period.from,
        to: ctx.period.to,
        zone: ctx.zone,
      });
      const occupancy = occupancyOf(
        available,
        booked.filter((b) => b.practitionerId === p.id),
      );
      const counts = counted.get(p.id);
      return {
        practitionerId: p.id,
        displayName: p.displayName,
        color: p.color,
        total: counts?.total ?? 0,
        completed: counts?.completed ?? 0,
        noShow: counts?.noShow ?? 0,
        cancelled: counts?.cancelled ?? 0,
        ...occupancy,
        rate: ratio(occupancy.bookedMinutes, occupancy.openMinutes),
      };
    });
    const openMinutes = byPractitioner.reduce((s, p) => s + p.openMinutes, 0);
    const bookedMinutes = byPractitioner.reduce((s, p) => s + p.bookedMinutes, 0);

    return {
      total,
      scheduled,
      completed,
      noShow,
      cancelled,
      noShowRate: ratio(noShow, completed + noShow),
      cancellationRate: ratio(cancelled, total + cancelled),
      patientsSeen: seen?.patientsSeen ?? 0,
      previousCompleted: seen?.previousCompleted ?? 0,
      upcomingNext7Days: upcoming?.count ?? 0,
      occupancy: { openMinutes, bookedMinutes, rate: ratio(bookedMinutes, openMinutes) },
      byPractitioner,
      series,
      topTypes: types.map((t) => ({ ...t, share: total > 0 ? t.count / total : 0 })),
    };
  }

  async function patientStats(ctx: Context) {
    const createdIn = (range: { start: Date; end: Date }) =>
      sql`${patients.createdSource} = 'STAFF' and ${patients.createdAt} >= ${range.start} and ${patients.createdAt} < ${range.end}`;
    const [row] = await ctx.tx
      .select({
        active: countWhere(sql`${patients.status} = 'ACTIVE'`),
        created: countWhere(createdIn(ctx.range)),
        previousNew: countWhere(createdIn(ctx.before)),
      })
      .from(patients)
      .where(eq(patients.clinicId, ctx.clinicId));
    return { active: row?.active ?? 0, new: row?.created ?? 0, previousNew: row?.previousNew ?? 0 };
  }

  /** Rendez-vous honorés de la période sans acte ouvert rattaché (oubli de facturation). */
  async function unbilled(ctx: Context) {
    const where = and(
      startingIn(ctx, ctx.range),
      eq(appointments.status, 'COMPLETED'),
      notExists(
        ctx.tx
          .select({ one: sql`1` })
          .from(charges)
          .where(
            and(
              eq(charges.clinicId, appointments.clinicId),
              eq(charges.appointmentId, appointments.id),
              eq(charges.status, 'OPEN'),
            ),
          ),
      ),
    );
    const [total] = await ctx.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(appointments)
      .where(where);
    const items = await ctx.tx
      .select({
        appointmentId: appointments.id,
        startAt: appointments.startAt,
        practitionerId: appointments.practitionerId,
        patientId: patients.id,
        lastName: patients.lastName,
        firstName: patients.firstName,
        appointmentTypeName: appointmentTypes.name,
      })
      .from(appointments)
      .innerJoin(
        patients,
        and(eq(patients.clinicId, appointments.clinicId), eq(patients.id, appointments.patientId)),
      )
      .innerJoin(
        appointmentTypes,
        and(
          eq(appointmentTypes.clinicId, appointments.clinicId),
          eq(appointmentTypes.id, appointments.appointmentTypeId),
        ),
      )
      .where(where)
      .orderBy(desc(appointments.startAt), asc(appointments.id))
      .limit(UNBILLED_ITEMS);
    return {
      count: total?.count ?? 0,
      items: items.map((i) => ({
        appointmentId: i.appointmentId,
        startAt: i.startAt.toISOString(),
        practitionerId: i.practitionerId,
        patient: { id: i.patientId, lastName: i.lastName, firstName: i.firstName },
        appointmentTypeName: i.appointmentTypeName,
      })),
    };
  }

  async function revenue(ctx: Context, actor: UserActor) {
    const scope = revenueScope(actor);
    const filter = {
      clinicId: ctx.clinicId,
      start: ctx.range.start,
      end: ctx.range.end,
      scope,
      practitionerId: ctx.practitionerId,
    };
    const totals = await revenueTotals(ctx.tx, filter);
    const previous = await revenueTotals(ctx.tx, {
      ...filter,
      start: ctx.before.start,
      end: ctx.before.end,
    });
    const series = await revenueByBucket(ctx.tx, filter, ctx.buckets.lower);
    return {
      totalCents: totals.totalCents,
      count: totals.count,
      previousTotalCents: previous.totalCents,
      voided: totals.voided,
      series: ctx.buckets.starts.map((start, i) => ({ start, ...series[i]! })),
      byPractitioner: await revenueByPractitioner(ctx.tx, filter),
    };
  }

  return { dashboard };
}
