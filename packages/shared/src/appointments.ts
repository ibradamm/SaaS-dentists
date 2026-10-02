import { z } from 'zod';
import {
  SCHEDULE_GRID_MINUTES,
  localDateSchema,
  localDateTimeSchema,
  listSchedulesResponseSchema,
  availabilityBlockSchema,
} from './scheduling';

/*
 * Rendez-vous (docs/adr/0007). Conventions de la Phase 4 : instants UTC en sortie, heure
 * locale du cabinet (« AAAA-MM-JJTHH:mm ») en saisie.
 */

/**
 * Statuts du MVP. Ajouter un statut : une ligne dans la table appointment_statuses
 * (migration), un libellé et ses transitions ci-dessous ; aucune refonte du modèle.
 */
export const APPOINTMENT_STATUSES = ['SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export interface StatusTransition {
  to: AppointmentStatus;
  /** Seulement une fois l'heure de début passée (on ne constate pas un rendez-vous futur). */
  requiresStarted?: boolean;
}

/** Transitions permises. « Annulé » est définitif : on recrée un rendez-vous. */
export const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly StatusTransition[]>
> = {
  SCHEDULED: [
    { to: 'COMPLETED', requiresStarted: true },
    { to: 'NO_SHOW', requiresStarted: true },
    { to: 'CANCELLED' },
  ],
  // Corrections d'une erreur de saisie.
  COMPLETED: [{ to: 'SCHEDULED' }],
  NO_SHOW: [{ to: 'SCHEDULED' }],
  CANCELLED: [],
};

export function findTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): StatusTransition | undefined {
  return APPOINTMENT_TRANSITIONS[from].find((t) => t.to === to);
}

/**
 * Raisons pour lesquelles une confirmation explicite est exigée (tracées dans l'audit) :
 * début déjà passé (ADR 0008), hors des horaires du praticien, sur un créneau bloqué.
 */
export const OVERRIDE_REASONS = ['IN_PAST', 'OUTSIDE_WORKING_HOURS', 'ON_BLOCK'] as const;
export const overrideReasonSchema = z.enum(OVERRIDE_REASONS);
export type OverrideReason = z.infer<typeof overrideReasonSchema>;

export const MAX_APPOINTMENT_LIST_DAYS = 62;
export const MIN_APPOINTMENT_MINUTES = 5;
export const MAX_APPOINTMENT_MINUTES = 480;

const durationSchema = z
  .number()
  .int()
  .min(MIN_APPOINTMENT_MINUTES)
  .max(MAX_APPOINTMENT_MINUTES)
  .refine((v) => v % SCHEDULE_GRID_MINUTES === 0, 'Durée en multiples de 5 minutes');
const noteSchema = z.string().trim().max(500).nullable();
const version = z.number().int().positive();

export const appointmentSchema = z.object({
  id: z.uuid(),
  practitionerId: z.uuid(),
  patient: z.object({
    id: z.uuid(),
    lastName: z.string(),
    firstName: z.string(),
    primaryPhone: z.string().nullable(),
  }),
  appointmentType: z.object({ id: z.uuid(), name: z.string(), color: z.string() }),
  startAt: z.string(),
  endAt: z.string(),
  durationMinutes: z.number().int(),
  status: appointmentStatusSchema,
  note: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  /** « Sans facturation » : ne compte pas comme oubli d'encaissement (docs/adr/0010). */
  billingExempt: z.boolean(),
  version: z.number().int(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const listAppointmentsQuerySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  practitionerId: z.uuid().optional(),
  includeCancelled: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type ListAppointmentsQuery = z.input<typeof listAppointmentsQuerySchema>;
export const listAppointmentsResponseSchema = z.object({
  appointments: z.array(appointmentSchema),
});

export const createAppointmentRequestSchema = z.object({
  practitionerId: z.uuid(),
  patientId: z.uuid(),
  appointmentTypeId: z.uuid(),
  /** Début en heure locale du cabinet. */
  start: localDateTimeSchema,
  /** Par défaut : durée du type de rendez-vous. */
  durationMinutes: durationSchema.optional(),
  note: noteSchema.default(null),
  /** Confirmation explicite d'un rendez-vous hors horaires ou sur un créneau bloqué. */
  allowOutsideAvailability: z.boolean().default(false),
  /**
   * Clé de la saisie (UUID tiré par l'interface, gardé pour chaque nouvel essai tant que l'issue
   * est inconnue) : un nouvel essai après une réponse perdue renvoie le rendez-vous déjà créé
   * au lieu d'un refus « créneau pris ». Facultative pour un appelant qui n'en a pas besoin.
   */
  idempotencyKey: z.uuid().optional(),
});
export type CreateAppointmentRequest = z.input<typeof createAppointmentRequestSchema>;

export const updateAppointmentRequestSchema = z
  .object({
    version,
    practitionerId: z.uuid().optional(),
    appointmentTypeId: z.uuid().optional(),
    start: localDateTimeSchema.optional(),
    durationMinutes: durationSchema.optional(),
    note: noteSchema.optional(),
    allowOutsideAvailability: z.boolean().default(false),
  })
  .refine(
    (v) =>
      [v.practitionerId, v.appointmentTypeId, v.start, v.durationMinutes, v.note].some(
        (x) => x !== undefined,
      ),
    'Aucune modification demandée',
  );
export type UpdateAppointmentRequest = z.input<typeof updateAppointmentRequestSchema>;

export const changeAppointmentStatusRequestSchema = z.object({
  version,
  status: appointmentStatusSchema,
  /** Motif d'annulation (facultatif, jamais recopié dans l'audit). */
  reason: z.string().trim().max(200).nullable().default(null),
});
export type ChangeAppointmentStatusRequest = z.input<typeof changeAppointmentStatusRequestSchema>;

export const slotsQuerySchema = z.object({
  practitionerId: z.uuid(),
  from: localDateSchema,
  to: localDateSchema,
  durationMinutes: z.coerce
    .number()
    .int()
    .min(MIN_APPOINTMENT_MINUTES)
    .max(MAX_APPOINTMENT_MINUTES)
    .refine((v) => v % SCHEDULE_GRID_MINUTES === 0, 'Durée en multiples de 5 minutes'),
  step: z.coerce
    .number()
    .int()
    .refine((v) => [5, 10, 15, 20, 30, 60].includes(v), 'Pas de 5, 10, 15, 20, 30 ou 60 minutes')
    .default(15),
});
export type SlotsQuery = z.input<typeof slotsQuerySchema>;
export const slotsResponseSchema = z.object({
  timezone: z.string(),
  /** Débuts de créneaux libres (instants UTC), 50 au plus. */
  slots: z.array(z.string()),
});

/** Écriture d'une indisponibilité : les rendez-vous en conflit sont listés, jamais modifiés. */
export const blockWriteResponseSchema = z.object({
  block: availabilityBlockSchema,
  conflicts: z.array(appointmentSchema),
});
export type BlockWriteResponse = z.infer<typeof blockWriteResponseSchema>;

/** Nouveaux horaires : rendez-vous prévus désormais hors horaires, listés sans être modifiés. */
export const setScheduleResponseSchema = listSchedulesResponseSchema.extend({
  conflicts: z.array(appointmentSchema),
});
export type SetScheduleResponse = z.infer<typeof setScheduleResponseSchema>;
