import {
  createAppointmentTypeRequestSchema,
  createPractitionerRequestSchema,
  updateAppointmentTypeRequestSchema,
  updatePractitionerRequestSchema,
  type AppointmentType,
  type CreateAppointmentTypeRequest,
  type CreatePractitionerRequest,
  type Practitioner,
  type UpdateAppointmentTypeRequest,
  type UpdatePractitionerRequest,
} from '@dental/shared';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { appointmentTypes, practitioners, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, pgErrorCode } from '../../lib/pg-errors';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';

export type PractitionersService = ReturnType<typeof createPractitionersService>;

const practitionerNotFound = () => new AppError('NOT_FOUND', 'Praticien introuvable', 404);
const typeNotFound = () => new AppError('NOT_FOUND', 'Type de rendez-vous introuvable', 404);
const staleVersion = () =>
  new AppError(
    'CONFLICT',
    "L'élément a été modifié par quelqu'un d'autre entre-temps. Rechargez la page.",
    409,
  );

type AuditChanges = Record<string, { from?: string | number | null; to?: string | number | null }>;

/**
 * Praticiens (ressources réservables) et types de rendez-vous : lecture par tout le personnel,
 * gestion par l'administrateur (clinic.settings.manage). Voir docs/adr/0006.
 */
export function createPractitionersService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  function audit(
    tx: Transaction,
    actor: UserActor,
    action: string,
    entity: { type: 'practitioner' | 'appointment_type'; id: string },
    meta: RequestMeta,
    changes: AuditChanges | null = null,
  ) {
    return recordAudit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      action,
      entityType: entity.type,
      entityId: entity.id,
      changes: changes && Object.keys(changes).length > 0 ? changes : null,
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  /** Différences entre l'état avant et la modification demandée (valeurs non sensibles). */
  function diff(before: Record<string, unknown>, patch: Record<string, unknown>): AuditChanges {
    const changes: AuditChanges = {};
    for (const [key, to] of Object.entries(patch)) {
      const from = before[key];
      if (to !== undefined && to !== from) {
        changes[key] = { from: from as string | number | null, to: to as string | number | null };
      }
    }
    return changes;
  }

  // --- Praticiens ------------------------------------------------------------------------

  const practitionerColumns = {
    id: practitioners.id,
    displayName: practitioners.displayName,
    color: practitioners.color,
    userId: practitioners.userId,
    userFullName: users.fullName,
    status: practitioners.status,
    version: practitioners.version,
  };

  async function readPractitioners(tx: Transaction, clinicId: string, where?: SQL) {
    return tx
      .select(practitionerColumns)
      .from(practitioners)
      .leftJoin(users, eq(users.id, practitioners.userId))
      .where(and(eq(practitioners.clinicId, clinicId), where))
      .orderBy(asc(practitioners.status), asc(practitioners.displayName), asc(practitioners.id));
  }

  async function practitionerById(tx: Transaction, clinicId: string, id: string) {
    const [row] = await readPractitioners(tx, clinicId, eq(practitioners.id, id));
    if (!row) throw practitionerNotFound();
    return row;
  }

  function linkError(error: unknown): never {
    const code = pgErrorCode(error);
    if (code === PG_UNIQUE_VIOLATION) {
      throw new AppError('CONFLICT', 'Ce compte est déjà lié à un autre praticien', 409);
    }
    if (code === PG_FOREIGN_KEY_VIOLATION) {
      throw new AppError('VALIDATION_FAILED', "Ce compte n'est pas membre du cabinet", 400);
    }
    throw error;
  }

  async function listPractitioners(
    actor: UserActor,
    options: { includeArchived: boolean },
  ): Promise<Practitioner[]> {
    authorize(actor, 'appointment.read');
    return withTenant(db, actor.clinicId, (tx) =>
      readPractitioners(
        tx,
        actor.clinicId,
        options.includeArchived ? undefined : eq(practitioners.status, 'ACTIVE'),
      ),
    );
  }

  async function createPractitioner(
    actor: UserActor,
    input: CreatePractitionerRequest,
    meta: RequestMeta,
  ): Promise<Practitioner> {
    authorize(actor, 'clinic.settings.manage');
    const data = createPractitionerRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const [row] = await tx
        .insert(practitioners)
        .values({
          clinicId: actor.clinicId,
          displayName: data.displayName,
          color: data.color,
          userId: data.userId,
        })
        .returning({ id: practitioners.id })
        .catch(linkError);
      await audit(tx, actor, 'practitioner.created', { type: 'practitioner', id: row!.id }, meta, {
        displayName: { to: data.displayName },
        userId: { to: data.userId },
      });
      return practitionerById(tx, actor.clinicId, row!.id);
    });
  }

  async function updatePractitioner(
    actor: UserActor,
    id: string,
    input: UpdatePractitionerRequest,
    meta: RequestMeta,
  ): Promise<Practitioner> {
    authorize(actor, 'clinic.settings.manage');
    const { version, ...patch } = updatePractitionerRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const before = await practitionerById(tx, actor.clinicId, id);
      const updated = await tx
        .update(practitioners)
        .set({ ...patch, version: sql`${practitioners.version} + 1` })
        .where(
          and(
            eq(practitioners.clinicId, actor.clinicId),
            eq(practitioners.id, id),
            eq(practitioners.version, version),
          ),
        )
        .returning({ id: practitioners.id })
        .catch(linkError);
      if (updated.length === 0) throw staleVersion();
      await audit(
        tx,
        actor,
        'practitioner.updated',
        { type: 'practitioner', id },
        meta,
        diff(before, patch),
      );
      return practitionerById(tx, actor.clinicId, id);
    });
  }

  async function setPractitionerStatus(
    actor: UserActor,
    id: string,
    version: number,
    status: 'ACTIVE' | 'ARCHIVED',
    meta: RequestMeta,
  ): Promise<Practitioner> {
    authorize(actor, 'clinic.settings.manage');
    return withTenant(db, actor.clinicId, async (tx) => {
      await practitionerById(tx, actor.clinicId, id);
      // Phase 5 : refuser l'archivage d'un praticien qui a des rendez-vous futurs (ADR 0006, R7).
      const updated = await tx
        .update(practitioners)
        .set({
          status,
          archivedAt: status === 'ARCHIVED' ? now() : null,
          version: sql`${practitioners.version} + 1`,
        })
        .where(
          and(
            eq(practitioners.clinicId, actor.clinicId),
            eq(practitioners.id, id),
            eq(practitioners.version, version),
          ),
        )
        .returning({ id: practitioners.id });
      if (updated.length === 0) throw staleVersion();
      await audit(
        tx,
        actor,
        status === 'ARCHIVED' ? 'practitioner.archived' : 'practitioner.restored',
        { type: 'practitioner', id },
        meta,
      );
      return practitionerById(tx, actor.clinicId, id);
    });
  }

  // --- Types de rendez-vous ----------------------------------------------------------------

  const typeColumns = {
    id: appointmentTypes.id,
    name: appointmentTypes.name,
    durationMinutes: appointmentTypes.durationMinutes,
    color: appointmentTypes.color,
    status: appointmentTypes.status,
    version: appointmentTypes.version,
  };

  async function typeById(tx: Transaction, clinicId: string, id: string) {
    const [row] = await tx
      .select(typeColumns)
      .from(appointmentTypes)
      .where(and(eq(appointmentTypes.clinicId, clinicId), eq(appointmentTypes.id, id)));
    if (!row) throw typeNotFound();
    return row;
  }

  function nameError(error: unknown): never {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      throw new AppError('CONFLICT', 'Un type de rendez-vous actif porte déjà ce nom', 409);
    }
    throw error;
  }

  async function listTypes(
    actor: UserActor,
    options: { includeArchived: boolean },
  ): Promise<AppointmentType[]> {
    authorize(actor, 'appointment.read');
    return withTenant(db, actor.clinicId, (tx) =>
      tx
        .select(typeColumns)
        .from(appointmentTypes)
        .where(
          and(
            eq(appointmentTypes.clinicId, actor.clinicId),
            options.includeArchived ? undefined : eq(appointmentTypes.status, 'ACTIVE'),
          ),
        )
        .orderBy(asc(appointmentTypes.status), asc(appointmentTypes.name)),
    );
  }

  async function createType(
    actor: UserActor,
    input: CreateAppointmentTypeRequest,
    meta: RequestMeta,
  ): Promise<AppointmentType> {
    authorize(actor, 'clinic.settings.manage');
    const data = createAppointmentTypeRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const [row] = await tx
        .insert(appointmentTypes)
        .values({ clinicId: actor.clinicId, ...data })
        .returning({ id: appointmentTypes.id })
        .catch(nameError);
      await audit(
        tx,
        actor,
        'appointment_type.created',
        { type: 'appointment_type', id: row!.id },
        meta,
        { name: { to: data.name }, durationMinutes: { to: data.durationMinutes } },
      );
      return typeById(tx, actor.clinicId, row!.id);
    });
  }

  async function updateType(
    actor: UserActor,
    id: string,
    input: UpdateAppointmentTypeRequest,
    meta: RequestMeta,
  ): Promise<AppointmentType> {
    authorize(actor, 'clinic.settings.manage');
    const { version, ...patch } = updateAppointmentTypeRequestSchema.parse(input);
    return withTenant(db, actor.clinicId, async (tx) => {
      const before = await typeById(tx, actor.clinicId, id);
      const updated = await tx
        .update(appointmentTypes)
        .set({ ...patch, version: sql`${appointmentTypes.version} + 1` })
        .where(
          and(
            eq(appointmentTypes.clinicId, actor.clinicId),
            eq(appointmentTypes.id, id),
            eq(appointmentTypes.version, version),
          ),
        )
        .returning({ id: appointmentTypes.id })
        .catch(nameError);
      if (updated.length === 0) throw staleVersion();
      await audit(
        tx,
        actor,
        'appointment_type.updated',
        { type: 'appointment_type', id },
        meta,
        diff(before, patch),
      );
      return typeById(tx, actor.clinicId, id);
    });
  }

  async function setTypeStatus(
    actor: UserActor,
    id: string,
    version: number,
    status: 'ACTIVE' | 'ARCHIVED',
    meta: RequestMeta,
  ): Promise<AppointmentType> {
    authorize(actor, 'clinic.settings.manage');
    return withTenant(db, actor.clinicId, async (tx) => {
      await typeById(tx, actor.clinicId, id);
      const updated = await tx
        .update(appointmentTypes)
        .set({
          status,
          archivedAt: status === 'ARCHIVED' ? now() : null,
          version: sql`${appointmentTypes.version} + 1`,
        })
        .where(
          and(
            eq(appointmentTypes.clinicId, actor.clinicId),
            eq(appointmentTypes.id, id),
            eq(appointmentTypes.version, version),
          ),
        )
        .returning({ id: appointmentTypes.id })
        .catch(nameError);
      if (updated.length === 0) throw staleVersion();
      await audit(
        tx,
        actor,
        status === 'ARCHIVED' ? 'appointment_type.archived' : 'appointment_type.restored',
        { type: 'appointment_type', id },
        meta,
      );
      return typeById(tx, actor.clinicId, id);
    });
  }

  return {
    listPractitioners,
    createPractitioner,
    updatePractitioner,
    archivePractitioner: (actor: UserActor, id: string, version: number, meta: RequestMeta) =>
      setPractitionerStatus(actor, id, version, 'ARCHIVED', meta),
    restorePractitioner: (actor: UserActor, id: string, version: number, meta: RequestMeta) =>
      setPractitionerStatus(actor, id, version, 'ACTIVE', meta),
    listTypes,
    createType,
    updateType,
    archiveType: (actor: UserActor, id: string, version: number, meta: RequestMeta) =>
      setTypeStatus(actor, id, version, 'ARCHIVED', meta),
    restoreType: (actor: UserActor, id: string, version: number, meta: RequestMeta) =>
      setTypeStatus(actor, id, version, 'ACTIVE', meta),
  };
}
