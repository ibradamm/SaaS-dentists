import type { ClinicResponse, UpdateClinicRequest } from '@dental/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { clinics } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { isValidTimeZone } from '../../lib/time';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';

export type ClinicService = ReturnType<typeof createClinicService>;

export function createClinicService(deps: { db: Database }) {
  const { db } = deps;

  async function get(actor: UserActor): Promise<ClinicResponse> {
    const [clinic] = await withTenant(db, actor.clinicId, (tx) =>
      tx.select().from(clinics).where(eq(clinics.id, actor.clinicId)),
    );
    if (!clinic) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
    return {
      id: clinic.id,
      name: clinic.name,
      timezone: clinic.timezone,
      locale: clinic.locale,
      currency: clinic.currency,
      countryCode: clinic.countryCode,
    };
  }

  async function update(
    actor: UserActor,
    input: UpdateClinicRequest,
    meta: RequestMeta,
  ): Promise<ClinicResponse> {
    authorize(actor, 'clinic.settings.manage');
    if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) {
      throw new AppError('VALIDATION_FAILED', 'Fuseau horaire inconnu', 400);
    }
    await withTenant(db, actor.clinicId, async (tx) => {
      const [before] = await tx.select().from(clinics).where(eq(clinics.id, actor.clinicId));
      if (!before) throw new AppError('NOT_FOUND', 'Cabinet introuvable', 404);
      const editable = ['name', 'timezone', 'locale'] as const;
      const patch: Partial<Record<(typeof editable)[number], string>> = {};
      const changes: Record<string, { from: string; to: string }> = {};
      for (const key of editable) {
        const value = input[key];
        if (value === undefined) continue;
        patch[key] = value;
        changes[key] = { from: before[key], to: value };
      }
      await tx.update(clinics).set(patch).where(eq(clinics.id, actor.clinicId));
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
    });
    return get(actor);
  }

  return { get, update };
}
