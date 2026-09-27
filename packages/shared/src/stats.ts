import { z } from 'zod';
import { currencySchema } from './money';
import { GRANULARITIES } from './periods';
import { localDateSchema } from './scheduling';

/*
 * Tableau de bord (docs/adr/0010). Chaque section n'est présente que si le compte a la
 * permission de ses données sources ; le serveur calcule tout, l'interface affiche.
 */

export const dashboardQuerySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  practitionerId: z.uuid().optional(),
});
export type DashboardQuery = z.input<typeof dashboardQuerySchema>;

const count = z.number().int().nonnegative();
const cents = z.number().int();
/** Fraction de 0 à 1 ; null quand le dénominateur est nul (« aucune donnée », pas « 0 % »). */
const rate = z.number().min(0).max(1).nullable();
const period = z.object({ from: localDateSchema, to: localDateSchema });
const occupancy = {
  bookedMinutes: count,
  openMinutes: count,
  rate,
};

export const activityStatsSchema = z.object({
  /** Rendez-vous de la période hors annulés. */
  total: count,
  scheduled: count,
  completed: count,
  noShow: count,
  cancelled: count,
  noShowRate: rate,
  cancellationRate: rate,
  patientsSeen: count,
  previousCompleted: count,
  /** Rendez-vous prévus dans les 7 prochains jours, à partir de maintenant. */
  upcomingNext7Days: count,
  occupancy: z.object(occupancy),
  byPractitioner: z.array(
    z.object({
      practitionerId: z.uuid(),
      displayName: z.string(),
      color: z.string(),
      total: count,
      completed: count,
      noShow: count,
      cancelled: count,
      ...occupancy,
    }),
  ),
  series: z.array(
    z.object({
      start: localDateSchema,
      scheduled: count,
      completed: count,
      noShow: count,
      cancelled: count,
    }),
  ),
  topTypes: z.array(
    z.object({
      appointmentTypeId: z.uuid(),
      name: z.string(),
      color: z.string(),
      count,
      share: z.number().min(0).max(1),
    }),
  ),
});
export type ActivityStats = z.infer<typeof activityStatsSchema>;

export const patientStatsSchema = z.object({
  active: count,
  /** Fiches créées par le cabinet dans la période (imports exclus). */
  new: count,
  previousNew: count,
});

export const receivablesStatsSchema = z.object({
  totalRemainingCents: cents,
  patients: count,
});

export const unbilledStatsSchema = z.object({
  count,
  items: z.array(
    z.object({
      appointmentId: z.uuid(),
      startAt: z.string(),
      patient: z.object({ id: z.uuid(), lastName: z.string(), firstName: z.string() }),
      appointmentTypeName: z.string(),
      practitionerId: z.uuid(),
    }),
  ),
});

export const revenueStatsSchema = z.object({
  totalCents: cents,
  count,
  previousTotalCents: cents,
  voided: z.object({ amountCents: cents, count }),
  series: z.array(z.object({ start: localDateSchema, amountCents: cents, count })),
  byPractitioner: z.array(
    z.object({
      practitionerId: z.uuid().nullable(),
      displayName: z.string().nullable(),
      amountCents: cents,
      count,
    }),
  ),
});

export const dashboardResponseSchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  previous: period,
  granularity: z.enum(GRANULARITIES),
  timezone: z.string(),
  currency: currencySchema,
  practitionerId: z.uuid().nullable(),
  activity: activityStatsSchema.optional(),
  patients: patientStatsSchema.optional(),
  receivables: receivablesStatsSchema.optional(),
  unbilled: unbilledStatsSchema.optional(),
  revenue: revenueStatsSchema.optional(),
});
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
