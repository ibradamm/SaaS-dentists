import { z } from 'zod';

/*
 * Contrats des praticiens, types de rendez-vous, horaires, indisponibilités et disponibilités
 * (docs/adr/0006). Conventions :
 * - `…At` : instant UTC au format ISO 8601 ;
 * - `…Date` / `validFrom` : date locale du cabinet (AAAA-MM-JJ) ;
 * - `start` / `end` d'une plage hebdomadaire : heure locale « HH:mm » (24:00 = minuit suivant) ;
 * - saisie d'une indisponibilité horaire : heure locale « AAAA-MM-JJTHH:mm » du cabinet.
 */

/** Pas de la grille horaire : horaires, durées et indisponibilités en multiples de 5 min. */
export const SCHEDULE_GRID_MINUTES = 5;
export const MAX_AVAILABILITY_DAYS = 62;
export const MAX_BLOCK_LIST_DAYS = 366;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

/** « HH:mm » → minutes depuis minuit ; « 24:00 » → 1440. */
export function timeToMinutes(value: string): number {
  if (!TIME.test(value)) throw new RangeError(`Heure invalide : ${value}`);
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Minutes depuis minuit → « HH:mm » (1440 → « 24:00 »). */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const onGrid = (minutes: number) => minutes % SCHEDULE_GRID_MINUTES === 0;
const gridMessage = `Heure sur une grille de ${SCHEDULE_GRID_MINUTES} minutes`;

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur au format #RRGGBB')
  .transform((v) => v.toLowerCase());

export const localDateSchema = z.iso.date();
export const localTimeSchema = z
  .string()
  .regex(TIME, 'Heure au format HH:mm')
  .refine((v) => onGrid(timeToMinutes(v)), gridMessage);
export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Date et heure au format AAAA-MM-JJTHH:mm')
  .refine((v) => onGrid(Number(v.slice(14, 16))), gridMessage);

const recordStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
const booleanQuery = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const version = z.number().int().positive();
const hasChange = (v: Record<string, unknown>) =>
  Object.entries(v).some(([k, x]) => k !== 'version' && x !== undefined);

// --- Praticiens --------------------------------------------------------------------------

export const practitionerSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  color: z.string(),
  /** Compte lié (connexion) ; null pour un praticien qui ne se connecte pas. */
  userId: z.uuid().nullable(),
  userFullName: z.string().nullable(),
  status: recordStatusSchema,
  version: z.number().int(),
});
export type Practitioner = z.infer<typeof practitionerSchema>;

export const listPractitionersQuerySchema = z.object({ includeArchived: booleanQuery });
export const listPractitionersResponseSchema = z.object({
  practitioners: z.array(practitionerSchema),
});

const displayName = z.string().trim().min(1, 'Obligatoire').max(100);

export const createPractitionerRequestSchema = z.object({
  displayName,
  color: hexColorSchema,
  userId: z.uuid().nullable().default(null),
});
export type CreatePractitionerRequest = z.input<typeof createPractitionerRequestSchema>;

export const updatePractitionerRequestSchema = z
  .object({
    version,
    displayName: displayName.optional(),
    color: hexColorSchema.optional(),
    userId: z.uuid().nullable().optional(),
  })
  .refine(hasChange, 'Aucune modification demandée');
export type UpdatePractitionerRequest = z.input<typeof updatePractitionerRequestSchema>;

export const versionBodySchema = z.object({ version });

// --- Types de rendez-vous ----------------------------------------------------------------

export const appointmentTypeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  durationMinutes: z.number().int(),
  color: z.string(),
  status: recordStatusSchema,
  version: z.number().int(),
});
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;

export const listAppointmentTypesResponseSchema = z.object({
  appointmentTypes: z.array(appointmentTypeSchema),
});

const durationMinutes = z
  .number()
  .int()
  .min(5)
  .max(480)
  .refine(onGrid, `Durée en multiples de ${SCHEDULE_GRID_MINUTES} minutes`);
const typeName = z.string().trim().min(1, 'Obligatoire').max(100);

export const createAppointmentTypeRequestSchema = z.object({
  name: typeName,
  durationMinutes,
  color: hexColorSchema,
});
export type CreateAppointmentTypeRequest = z.input<typeof createAppointmentTypeRequestSchema>;

export const updateAppointmentTypeRequestSchema = z
  .object({
    version,
    name: typeName.optional(),
    durationMinutes: durationMinutes.optional(),
    color: hexColorSchema.optional(),
  })
  .refine(hasChange, 'Aucune modification demandée');
export type UpdateAppointmentTypeRequest = z.input<typeof updateAppointmentTypeRequestSchema>;

// --- Horaires de travail -----------------------------------------------------------------

export const weeklyIntervalSchema = z
  .object({
    /** Jour ISO : 1 = lundi … 7 = dimanche. */
    weekday: z.number().int().min(1).max(7),
    start: localTimeSchema,
    end: localTimeSchema,
  })
  .refine((v) => timeToMinutes(v.start) < timeToMinutes(v.end), {
    message: 'La fin doit être après le début',
    path: ['end'],
  });
export type WeeklyIntervalInput = z.infer<typeof weeklyIntervalSchema>;

export const schedulePeriodSchema = z.object({
  id: z.uuid(),
  validFrom: z.string(),
  /** Date de fin exclue ; null = sans fin. */
  validTo: z.string().nullable(),
  version: z.number().int(),
  intervals: z.array(z.object({ weekday: z.number().int(), start: z.string(), end: z.string() })),
});
export type SchedulePeriod = z.infer<typeof schedulePeriodSchema>;

export const listSchedulesResponseSchema = z.object({ periods: z.array(schedulePeriodSchema) });

/** Deux plages d'un même jour ne se chevauchent pas (les plages adjacentes sont permises). */
function noOverlap(intervals: readonly WeeklyIntervalInput[]): boolean {
  const sorted = [...intervals].sort(
    (a, b) => a.weekday - b.weekday || timeToMinutes(a.start) - timeToMinutes(b.start),
  );
  return sorted.every((current, i) => {
    const previous = sorted[i - 1];
    return (
      !previous ||
      previous.weekday !== current.weekday ||
      timeToMinutes(previous.end) <= timeToMinutes(current.start)
    );
  });
}

export const setScheduleRequestSchema = z.object({
  /** Premier jour d'application (date locale du cabinet, aujourd'hui ou plus tard). */
  validFrom: localDateSchema,
  /**
   * Période en vigueur à cette date lors de la lecture (identifiant et version) ; null s'il n'y
   * en avait pas. Toute différence au moment de l'écriture est un conflit : quelqu'un d'autre a
   * modifié l'agenda entre-temps.
   */
  basePeriod: z.object({ id: z.uuid(), version }).nullable(),
  intervals: z
    .array(weeklyIntervalSchema)
    .max(50)
    .refine(noOverlap, 'Deux plages du même jour se chevauchent'),
});
export type SetScheduleRequest = z.infer<typeof setScheduleRequestSchema>;

// --- Absences, congés et blocages --------------------------------------------------------

export const BLOCK_KINDS = ['ABSENCE', 'BLOCK'] as const;
export const blockKindSchema = z.enum(BLOCK_KINDS);
export type BlockKind = z.infer<typeof blockKindSchema>;

export const availabilityBlockSchema = z.object({
  id: z.uuid(),
  /** null : tout le cabinet (fermeture, jour férié, réunion d'équipe). */
  practitionerId: z.uuid().nullable(),
  kind: blockKindSchema,
  startAt: z.string(),
  endAt: z.string(),
  allDay: z.boolean(),
  label: z.string().nullable(),
  version: z.number().int(),
});
export type AvailabilityBlock = z.infer<typeof availabilityBlockSchema>;

export const listBlocksQuerySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  practitionerId: z.uuid().optional(),
});
export const listBlocksResponseSchema = z.object({ blocks: z.array(availabilityBlockSchema) });

const label = z.string().trim().max(100).nullable().default(null);

/** Période d'une indisponibilité : journées entières (dates incluses) ou heures locales. */
const blockTimingSchema = z.discriminatedUnion('allDay', [
  z.object({ allDay: z.literal(true), startDate: localDateSchema, endDate: localDateSchema }),
  z.object({ allDay: z.literal(false), start: localDateTimeSchema, end: localDateTimeSchema }),
]);
export type BlockTiming = z.infer<typeof blockTimingSchema>;

export const createBlockRequestSchema = z.intersection(
  z.object({ practitionerId: z.uuid().nullable(), kind: blockKindSchema, label }),
  blockTimingSchema,
);
export type CreateBlockRequest = z.input<typeof createBlockRequestSchema>;

/** Remplacement complet d'une indisponibilité (le praticien concerné ne change pas). */
export const replaceBlockRequestSchema = z.intersection(
  z.object({ version, kind: blockKindSchema, label }),
  blockTimingSchema,
);
export type ReplaceBlockRequest = z.input<typeof replaceBlockRequestSchema>;

// --- Disponibilités ----------------------------------------------------------------------

export const availabilityQuerySchema = z.object({
  from: localDateSchema,
  to: localDateSchema,
  practitionerId: z.uuid().optional(),
});

const instantInterval = z.object({ start: z.string(), end: z.string() });

export const availabilityResponseSchema = z.object({
  timezone: z.string(),
  from: z.string(),
  to: z.string(),
  practitioners: z.array(
    z.object({
      practitionerId: z.uuid(),
      /** Plages de travail selon les horaires. */
      working: z.array(instantInterval),
      /** Plages de travail moins absences et blocages (et, en Phase 5, rendez-vous). */
      available: z.array(instantInterval),
    }),
  ),
  blocks: z.array(availabilityBlockSchema),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;
