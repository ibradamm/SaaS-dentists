import {
  APPOINTMENT_STATUSES,
  MAX_APPOINTMENT_LIST_DAYS,
  changeAppointmentStatusRequestSchema,
  createAppointmentRequestSchema,
  findTransition,
  listAppointmentsQuerySchema,
  slotsQuerySchema,
  updateAppointmentRequestSchema,
  type Appointment,
  type AppointmentStatus,
  type ChangeAppointmentStatusRequest,
  type CreateAppointmentRequest,
  type OverrideReason,
  type UpdateAppointmentRequest,
} from '@dental/shared';
import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import {
  appointments,
  appointmentTypes,
  patients,
  practitioners,
  type AppointmentRow,
} from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { PG_EXCLUSION_VIOLATION, pgErrorCode } from '../../lib/pg-errors';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';
import { computeAvailability, slotStarts, workingIntervals } from '../scheduling/availability';
import { subtract } from '../scheduling/intervals';
import { addDays, localDateOf, localDateTimeToInstant } from '../scheduling/local-time';
import { lockPractitioners } from '../scheduling/locks';
import {
  checkRange,
  clinicZone,
  rangeInstants,
  readBlocks,
  readPeriods,
} from '../scheduling/queries';
import { occupiedIntervals, overlapping, readAppointments } from './queries';
import { evaluateSlot, type EvaluatedBlock } from './rules';

export type AppointmentsService = ReturnType<typeof createAppointmentsService>;

const MINUTE = 60_000;
const MAX_SLOTS = 50;
const MAX_SLOT_SEARCH_DAYS = 31;

const notFound = () => new AppError('NOT_FOUND', 'Rendez-vous introuvable', 404);
const staleVersion = () =>
  new AppError(
    'CONFLICT',
    "Le rendez-vous a été modifié par quelqu'un d'autre entre-temps. Rechargez l'agenda.",
    409,
  );
const slotUnavailable = (message = 'Ce créneau est déjà pris') =>
  new AppError('SLOT_UNAVAILABLE', message, 409);

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'prévu',
  COMPLETED: 'honoré',
  NO_SHOW: 'patient absent',
  CANCELLED: 'annulé',
};

type AuditValue = string | number | boolean | null;

/**
 * Rendez-vous (docs/adr/0007). Anti double réservation garantie par la base (contraintes
 * d'exclusion) ; absences, horaires et blocages vérifiés ici, sous le verrou du praticien
 * partagé avec les horaires et les indisponibilités.
 */
export function createAppointmentsService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  function audit(
    tx: Transaction,
    actor: UserActor,
    action: string,
    id: string,
    meta: RequestMeta,
    changes: Record<string, { from?: AuditValue; to?: AuditValue }> | null,
  ) {
    return recordAudit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      action,
      entityType: 'appointment',
      entityId: id,
      changes,
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  async function activeRow<T extends { status: string }>(
    rows: Promise<T[]>,
    notFoundMessage: string,
    archivedMessage: string,
  ): Promise<T> {
    const [row] = await rows;
    if (!row) throw new AppError('NOT_FOUND', notFoundMessage, 404);
    if (row.status !== 'ACTIVE') throw new AppError('CONFLICT', archivedMessage, 409);
    return row;
  }

  const activePractitioner = (tx: Transaction, clinicId: string, id: string) =>
    activeRow(
      tx
        .select({ id: practitioners.id, status: practitioners.status })
        .from(practitioners)
        .where(and(eq(practitioners.clinicId, clinicId), eq(practitioners.id, id))),
      'Praticien introuvable',
      'Ce praticien est archivé : il ne reçoit plus de rendez-vous',
    );
  const activePatient = (tx: Transaction, clinicId: string, id: string) =>
    activeRow(
      tx
        .select({ id: patients.id, status: patients.status })
        .from(patients)
        .where(and(eq(patients.clinicId, clinicId), eq(patients.id, id))),
      'Patient introuvable',
      'Ce patient est archivé : restaurez sa fiche avant de lui donner rendez-vous',
    );
  const activeType = (tx: Transaction, clinicId: string, id: string) =>
    activeRow(
      tx
        .select({
          id: appointmentTypes.id,
          status: appointmentTypes.status,
          durationMinutes: appointmentTypes.durationMinutes,
        })
        .from(appointmentTypes)
        .where(and(eq(appointmentTypes.clinicId, clinicId), eq(appointmentTypes.id, id))),
      'Type de rendez-vous introuvable',
      'Ce type de rendez-vous est archivé',
    );

  function startInstant(value: string, zone: string): number {
    const result = localDateTimeToInstant(value, zone);
    if (!result.ok) {
      throw new AppError(
        'VALIDATION_FAILED',
        result.code === 'NONEXISTENT'
          ? "Cette heure n'existe pas ce jour-là (changement d'heure)"
          : 'Date ou heure invalide',
        400,
      );
    }
    return result.instant;
  }

  async function findRow(tx: Transaction, clinicId: string, id: string): Promise<AppointmentRow> {
    const [row] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.clinicId, clinicId), eq(appointments.id, id)));
    if (!row) throw notFound();
    return row;
  }

  async function readOne(tx: Transaction, clinicId: string, id: string): Promise<Appointment> {
    const [appointment] = await readAppointments(tx, clinicId, eq(appointments.id, id));
    if (!appointment) throw notFound();
    return appointment;
  }

  /**
   * Vérifie qu'un rendez-vous peut occuper [start, end) (ADR 0007, section 4) et renvoie les
   * raisons de la dérogation confirmée (vide si aucune). À appeler sous le verrou du praticien.
   */
  async function checkPlacement(
    tx: Transaction,
    clinicId: string,
    placement: {
      practitionerId: string;
      patientId: string;
      start: number;
      end: number;
      excludeId: string | null;
      allowOutsideAvailability: boolean;
      zone: string;
    },
  ): Promise<{ reasons: OverrideReason[]; blocks: EvaluatedBlock[] }> {
    const { practitionerId, start, end, zone } = placement;
    const from = addDays(localDateOf(start, zone), -1);
    const to = localDateOf(end, zone);
    const periods = await readPeriods(tx, clinicId, [practitionerId], { from, to });
    const working = workingIntervals(periods, from, to, zone);
    const blocks = (
      await readBlocks(tx, clinicId, { start: new Date(start), end: new Date(end) }, [
        practitionerId,
      ])
    ).map((b) => ({
      kind: b.kind,
      start: b.startAt.getTime(),
      end: b.endAt.getTime(),
      label: b.label,
    }));
    const evaluation = evaluateSlot({ start, end }, working, blocks);
    if (evaluation.absent) {
      throw new AppError(
        'PRACTITIONER_ABSENT',
        evaluation.absences.some((a) => a.label)
          ? `Le praticien est absent à ce moment (${evaluation.absences
              .map((a) => a.label)
              .filter(Boolean)
              .join(', ')}) : aucun rendez-vous possible`
          : 'Le praticien est absent à ce moment : aucun rendez-vous possible',
        409,
      );
    }
    if (evaluation.reasons.length > 0 && !placement.allowOutsideAvailability) {
      const parts = evaluation.reasons.map((r) =>
        r === 'OUTSIDE_WORKING_HOURS'
          ? 'hors des horaires du praticien'
          : `sur un créneau bloqué${
              evaluation.blocks.some((b) => b.label)
                ? ` (${evaluation.blocks
                    .map((b) => b.label)
                    .filter(Boolean)
                    .join(', ')})`
                : ''
            }`,
      );
      throw new AppError(
        'AVAILABILITY_CONFIRMATION_REQUIRED',
        `Ce rendez-vous est ${parts.join(' et ')}. Confirmez pour l'enregistrer quand même.`,
        409,
      );
    }
    // Contrôle préalable pour un message clair ; la contrainte d'exclusion reste la garantie.
    const clash = await tx
      .select({ practitionerId: appointments.practitionerId })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, clinicId),
          eq(appointments.occupiesSlot, true),
          or(
            eq(appointments.practitionerId, practitionerId),
            eq(appointments.patientId, placement.patientId),
          ),
          overlapping({ start: new Date(start), end: new Date(end) }),
          placement.excludeId ? ne(appointments.id, placement.excludeId) : undefined,
        ),
      )
      .limit(1);
    if (clash[0]) {
      throw slotUnavailable(
        clash[0].practitionerId === practitionerId
          ? 'Le praticien a déjà un rendez-vous sur ce créneau'
          : 'Le patient a déjà un rendez-vous à ce moment',
      );
    }
    return { reasons: evaluation.reasons, blocks: evaluation.blocks };
  }

  function exclusionError(error: unknown): never {
    if (pgErrorCode(error) === PG_EXCLUSION_VIOLATION) throw slotUnavailable();
    throw error;
  }

  async function auditOverride(
    tx: Transaction,
    actor: UserActor,
    id: string,
    meta: RequestMeta,
    placement: { reasons: OverrideReason[]; start: number; end: number },
  ) {
    if (placement.reasons.length === 0) return;
    // Dérogation confirmée par la personne : tracée à part pour être retrouvée facilement.
    await audit(tx, actor, 'appointment.availability_override', id, meta, {
      reasons: { to: placement.reasons.join(',') },
      startAt: { to: new Date(placement.start).toISOString() },
      endAt: { to: new Date(placement.end).toISOString() },
    });
  }

  // --- Lecture -----------------------------------------------------------------------------

  async function list(actor: UserActor, query: Record<string, unknown>): Promise<Appointment[]> {
    authorize(actor, 'appointment.read');
    const q = listAppointmentsQuerySchema.parse(query);
    checkRange(q.from, q.to, MAX_APPOINTMENT_LIST_DAYS);
    return withTenant(db, actor.clinicId, async (tx) => {
      const range = rangeInstants(await clinicZone(tx, actor.clinicId), q.from, q.to);
      return readAppointments(
        tx,
        actor.clinicId,
        and(
          overlapping(range),
          q.practitionerId ? eq(appointments.practitionerId, q.practitionerId) : undefined,
          q.includeCancelled ? undefined : ne(appointments.status, 'CANCELLED'),
        ),
      );
    });
  }

  async function get(actor: UserActor, id: string): Promise<Appointment> {
    authorize(actor, 'appointment.read');
    return withTenant(db, actor.clinicId, (tx) => readOne(tx, actor.clinicId, id));
  }

  /** Historique d'un patient (tous statuts), du plus récent au plus ancien. */
  async function forPatient(actor: UserActor, patientId: string): Promise<Appointment[]> {
    authorize(actor, 'appointment.read');
    return withTenant(db, actor.clinicId, async (tx) => {
      const [patient] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.clinicId, actor.clinicId), eq(patients.id, patientId)));
      if (!patient) throw new AppError('NOT_FOUND', 'Patient introuvable', 404);
      return readAppointments(tx, actor.clinicId, eq(appointments.patientId, patientId), {
        order: 'desc',
        limit: 200,
      });
    });
  }

  /** Créneaux libres : disponibilités moins rendez-vous, alignés sur l'horloge locale. */
  async function slots(actor: UserActor, query: Record<string, unknown>) {
    authorize(actor, 'appointment.read');
    const q = slotsQuerySchema.parse(query);
    checkRange(q.from, q.to, MAX_SLOT_SEARCH_DAYS);
    return withTenant(db, actor.clinicId, async (tx) => {
      await activePractitioner(tx, actor.clinicId, q.practitionerId);
      const zone = await clinicZone(tx, actor.clinicId);
      const range = rangeInstants(zone, q.from, q.to);
      const periods = await readPeriods(tx, actor.clinicId, [q.practitionerId], {
        from: q.from,
        to: q.to,
      });
      const blocks = await readBlocks(tx, actor.clinicId, range, [q.practitionerId]);
      const { available } = computeAvailability({
        periods,
        unavailabilities: blocks.map((b) => ({
          kind: b.kind,
          start: b.startAt.getTime(),
          end: b.endAt.getTime(),
        })),
        from: q.from,
        to: q.to,
        zone,
      });
      const busy = await occupiedIntervals(tx, actor.clinicId, [q.practitionerId], range);
      // Libre = disponible − rendez-vous − passé.
      const past = { start: range.start.getTime(), end: now().getTime() };
      const free = subtract(subtract(available, busy), [past]);
      return {
        timezone: zone,
        slots: slotStarts(free, q.durationMinutes, q.step, zone)
          .slice(0, MAX_SLOTS)
          .map((s) => new Date(s).toISOString()),
      };
    });
  }

  // --- Écriture ----------------------------------------------------------------------------

  async function create(
    actor: UserActor,
    input: CreateAppointmentRequest,
    meta: RequestMeta,
  ): Promise<Appointment> {
    authorize(actor, 'appointment.write');
    const data = createAppointmentRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      await activePractitioner(tx, actor.clinicId, data.practitionerId);
      await activePatient(tx, actor.clinicId, data.patientId);
      const type = await activeType(tx, actor.clinicId, data.appointmentTypeId);
      const zone = await clinicZone(tx, actor.clinicId);
      const start = startInstant(data.start, zone);
      const end = start + (data.durationMinutes ?? type.durationMinutes) * MINUTE;
      await lockPractitioners(tx, [data.practitionerId]);
      const placement = await checkPlacement(tx, actor.clinicId, {
        practitionerId: data.practitionerId,
        patientId: data.patientId,
        start,
        end,
        excludeId: null,
        allowOutsideAvailability: data.allowOutsideAvailability,
        zone,
      });
      const [row] = await tx
        .insert(appointments)
        .values({
          clinicId: actor.clinicId,
          practitionerId: data.practitionerId,
          patientId: data.patientId,
          appointmentTypeId: data.appointmentTypeId,
          startAt: new Date(start),
          endAt: new Date(end),
          note: data.note || null,
          createdBy: actor.userId,
        })
        .returning({ id: appointments.id })
        .catch(exclusionError);
      const id = row!.id;
      await audit(tx, actor, 'appointment.created', id, meta, {
        practitionerId: { to: data.practitionerId },
        patientId: { to: data.patientId },
        appointmentTypeId: { to: data.appointmentTypeId },
        startAt: { to: new Date(start).toISOString() },
        endAt: { to: new Date(end).toISOString() },
      });
      await auditOverride(tx, actor, id, meta, { reasons: placement.reasons, start, end });
      return readOne(tx, actor.clinicId, id);
    });
  }

  /** Déplacement, changement de praticien, de type, de durée ou de note (rendez-vous prévu). */
  async function update(
    actor: UserActor,
    id: string,
    input: UpdateAppointmentRequest,
    meta: RequestMeta,
  ): Promise<Appointment> {
    authorize(actor, 'appointment.write');
    const data = updateAppointmentRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const current = await findRow(tx, actor.clinicId, id);
      if (current.version !== data.version) throw staleVersion();
      if (current.status !== 'SCHEDULED') {
        throw new AppError('CONFLICT', 'Seul un rendez-vous prévu peut être modifié', 409);
      }
      const practitionerId = data.practitionerId ?? current.practitionerId;
      if (practitionerId !== current.practitionerId) {
        await activePractitioner(tx, actor.clinicId, practitionerId);
      }
      const typeId = data.appointmentTypeId ?? current.appointmentTypeId;
      if (typeId !== current.appointmentTypeId) await activeType(tx, actor.clinicId, typeId);
      const zone = await clinicZone(tx, actor.clinicId);
      const start = data.start ? startInstant(data.start, zone) : current.startAt.getTime();
      const duration =
        data.durationMinutes ?? (current.endAt.getTime() - current.startAt.getTime()) / MINUTE;
      const end = start + duration * MINUTE;
      const moved =
        practitionerId !== current.practitionerId ||
        start !== current.startAt.getTime() ||
        end !== current.endAt.getTime();

      let reasons: OverrideReason[] = [];
      if (moved) {
        await lockPractitioners(tx, [current.practitionerId, practitionerId]);
        reasons = (
          await checkPlacement(tx, actor.clinicId, {
            practitionerId,
            patientId: current.patientId,
            start,
            end,
            excludeId: id,
            allowOutsideAvailability: data.allowOutsideAvailability,
            zone,
          })
        ).reasons;
      }
      const updated = await tx
        .update(appointments)
        .set({
          practitionerId,
          appointmentTypeId: typeId,
          startAt: new Date(start),
          endAt: new Date(end),
          ...(data.note !== undefined ? { note: data.note || null } : {}),
          version: sql`${appointments.version} + 1`,
        })
        .where(
          and(
            eq(appointments.clinicId, actor.clinicId),
            eq(appointments.id, id),
            eq(appointments.version, data.version),
          ),
        )
        .returning({ id: appointments.id })
        .catch(exclusionError);
      if (updated.length === 0) throw staleVersion();

      const changes: Record<string, { from?: AuditValue; to?: AuditValue }> = {};
      if (practitionerId !== current.practitionerId) {
        changes.practitionerId = { from: current.practitionerId, to: practitionerId };
      }
      if (typeId !== current.appointmentTypeId) {
        changes.appointmentTypeId = { from: current.appointmentTypeId, to: typeId };
      }
      if (start !== current.startAt.getTime()) {
        changes.startAt = {
          from: current.startAt.toISOString(),
          to: new Date(start).toISOString(),
        };
      }
      if (end !== current.endAt.getTime()) {
        changes.endAt = { from: current.endAt.toISOString(), to: new Date(end).toISOString() };
      }
      // La note n'est jamais recopiée : seul le fait qu'elle a changé est tracé.
      if (data.note !== undefined && (data.note || null) !== current.note) changes.note = {};
      await audit(tx, actor, 'appointment.updated', id, meta, changes);
      await auditOverride(tx, actor, id, meta, { reasons, start, end });
      return readOne(tx, actor.clinicId, id);
    });
  }

  async function changeStatus(
    actor: UserActor,
    id: string,
    input: ChangeAppointmentStatusRequest,
    meta: RequestMeta,
  ): Promise<Appointment> {
    authorize(actor, 'appointment.write');
    const data = changeAppointmentStatusRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const current = await findRow(tx, actor.clinicId, id);
      if (current.version !== data.version) throw staleVersion();
      const from = current.status as AppointmentStatus;
      if (!APPOINTMENT_STATUSES.includes(from)) {
        throw new AppError('CONFLICT', 'Statut actuel non géré par cette version', 409);
      }
      const transition = findTransition(from, data.status);
      if (!transition) {
        throw new AppError(
          'CONFLICT',
          `Passage impossible de « ${STATUS_LABELS[from]} » à « ${STATUS_LABELS[data.status]} »`,
          409,
        );
      }
      if (transition.requiresStarted && current.startAt.getTime() > now().getTime()) {
        throw new AppError(
          'CONFLICT',
          `Un rendez-vous ne peut être déclaré « ${STATUS_LABELS[data.status]} » qu'après son heure de début`,
          409,
        );
      }
      await lockPractitioners(tx, [current.practitionerId]);
      if (!current.occupiesSlot && data.status === 'SCHEDULED') {
        // Le créneau libéré (patient absent) a pu être repris entre-temps.
        const [clash] = await tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(
            and(
              eq(appointments.clinicId, actor.clinicId),
              eq(appointments.occupiesSlot, true),
              ne(appointments.id, id),
              or(
                eq(appointments.practitionerId, current.practitionerId),
                eq(appointments.patientId, current.patientId),
              ),
              overlapping({ start: current.startAt, end: current.endAt }),
            ),
          )
          .limit(1);
        if (clash) throw slotUnavailable('Le créneau a été repris par un autre rendez-vous');
      }
      const cancelling = data.status === 'CANCELLED';
      const updated = await tx
        .update(appointments)
        .set({
          status: data.status,
          ...(cancelling
            ? {
                cancelledAt: now(),
                cancelledBy: actor.userId,
                cancellationReason: data.reason || null,
              }
            : {}),
          version: sql`${appointments.version} + 1`,
        })
        .where(
          and(
            eq(appointments.clinicId, actor.clinicId),
            eq(appointments.id, id),
            eq(appointments.version, data.version),
          ),
        )
        .returning({ id: appointments.id })
        .catch(exclusionError);
      if (updated.length === 0) throw staleVersion();
      await audit(tx, actor, 'appointment.status_changed', id, meta, {
        status: { from, to: data.status },
        ...(cancelling && data.reason ? { cancellationReason: {} } : {}),
      });
      return readOne(tx, actor.clinicId, id);
    });
  }

  return { list, get, forPatient, slots, create, update, changeStatus };
}
