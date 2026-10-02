import type { ClinicResponse, UpdateClinicRequest } from '@dental/shared';
import { updateClinicRequestSchema } from '@dental/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../db/client';
import { availabilityBlocks, clinics, type Clinic } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { isValidTimeZone } from '../../lib/time';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';
import { normalizePhone } from '../patients/normalize';
import { localDateOf, wallClockToInstant } from '../scheduling/local-time';

export type ClinicService = ReturnType<typeof createClinicService>;

const TEXT_FIELDS = ['name', 'timezone', 'locale'] as const;
const CONTACT_FIELDS = [
  'addressLine1',
  'addressLine2',
  'postalCode',
  'city',
  'phone',
  'email',
] as const;

function toResponse(clinic: Clinic): ClinicResponse {
  return {
    id: clinic.id,
    name: clinic.name,
    timezone: clinic.timezone,
    locale: clinic.locale,
    currency: clinic.currency,
    countryCode: clinic.countryCode,
    addressLine1: clinic.addressLine1,
    addressLine2: clinic.addressLine2,
    postalCode: clinic.postalCode,
    city: clinic.city,
    phone: clinic.phone,
    email: clinic.email,
  };
}

export function createClinicService(deps: { db: Database }) {
  const { db } = deps;

  async function read(tx: Transaction, clinicId: string): Promise<Clinic> {
    const [clinic] = await tx.select().from(clinics).where(eq(clinics.id, clinicId));
    if (!clinic) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
    return clinic;
  }

  async function get(actor: UserActor): Promise<ClinicResponse> {
    return toResponse(await withTenant(db, actor.clinicId, (tx) => read(tx, actor.clinicId)));
  }

  /**
   * Changement de fuseau : les horaires gardent leur heure locale ; les indisponibilités
   * « journée entière » sont recalées sur les minuits du nouveau fuseau (docs/adr/0006).
   */
  async function reanchorAllDayBlocks(
    tx: Transaction,
    clinicId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const blocks = await tx
      .select()
      .from(availabilityBlocks)
      .where(and(eq(availabilityBlocks.clinicId, clinicId), eq(availabilityBlocks.allDay, true)));
    for (const block of blocks) {
      const startDate = localDateOf(block.startAt.getTime(), from);
      const endDate = localDateOf(block.endAt.getTime(), from);
      await tx
        .update(availabilityBlocks)
        .set({
          startAt: new Date(wallClockToInstant(startDate, 0, to)),
          endAt: new Date(wallClockToInstant(endDate, 0, to)),
          version: sql`${availabilityBlocks.version} + 1`,
        })
        .where(and(eq(availabilityBlocks.clinicId, clinicId), eq(availabilityBlocks.id, block.id)));
    }
    return blocks.length;
  }

  async function update(
    actor: UserActor,
    input: UpdateClinicRequest,
    meta: RequestMeta,
  ): Promise<ClinicResponse> {
    authorize(actor, 'clinic.settings.manage');
    const data = updateClinicRequestSchema.parse(input);
    if (data.timezone !== undefined && !isValidTimeZone(data.timezone)) {
      throw new AppError('VALIDATION_FAILED', 'Fuseau horaire inconnu', 400);
    }
    return withTenant(db, actor.clinicId, async (tx) => {
      const before = await read(tx, actor.clinicId);
      const patch: Partial<Record<(typeof TEXT_FIELDS)[number], string>> &
        Partial<Record<(typeof CONTACT_FIELDS)[number], string | null>> = {};
      const changes: Record<
        string,
        { from?: string | number | null; to?: string | number | null }
      > = {};
      for (const key of TEXT_FIELDS) {
        const value = data[key];
        if (value === undefined || value === before[key]) continue;
        patch[key] = value;
        changes[key] = { from: before[key], to: value };
      }
      for (const key of CONTACT_FIELDS) {
        let value = data[key];
        if (value === undefined) continue;
        if (value === '') value = null;
        if (key === 'phone' && value !== null) {
          const phone = normalizePhone(value, before.countryCode);
          if (!phone) throw new AppError('VALIDATION_FAILED', 'Numéro de téléphone invalide', 400);
          value = phone;
        }
        if (value === before[key]) continue;
        patch[key] = value;
        // Coordonnées professionnelles du cabinet : seul le nom du champ est tracé.
        changes[key] = {};
      }
      if (Object.keys(patch).length > 0) {
        await tx.update(clinics).set(patch).where(eq(clinics.id, actor.clinicId));
      }
      if (patch.timezone !== undefined) {
        const moved = await reanchorAllDayBlocks(
          tx,
          actor.clinicId,
          before.timezone,
          patch.timezone,
        );
        changes.allDayBlocksReanchored = { to: moved };
      }
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, {
          actorType: 'USER',
          actorId: actor.userId,
          action: 'clinic.settings_update',
          entityType: 'clinic',
          entityId: actor.clinicId,
          changes,
          requestId: meta.requestId,
          ip: meta.ip,
        });
      }
      return toResponse(await read(tx, actor.clinicId));
    });
  }

  return { get, update };
}
