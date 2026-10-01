import { eq, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { isValidTimeZone } from '../../lib/time';
import type { Database } from '../client';
import { clinics, type Clinic } from '../schema';
import { withTenant } from '../tenant';

export const provisionClinicInput = z.object({
  name: z.string().trim().min(1).max(200),
  timezone: z.string().refine(isValidTimeZone, 'fuseau horaire IANA inconnu'),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
});
export type ProvisionClinicInput = z.infer<typeof provisionClinicInput>;

/**
 * Création d'un cabinet : opération d'administration, exécutée avec le rôle propriétaire
 * (le rôle applicatif n'a pas le droit INSERT sur clinics). La RLS étant forcée, le contexte
 * du nouveau cabinet est positionné avant l'insertion.
 */
export async function provisionClinic(
  ownerDb: Database,
  input: ProvisionClinicInput,
): Promise<Clinic> {
  const data = provisionClinicInput.parse(input);
  const id = uuidv7();
  return ownerDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.clinic_id', ${id}, true)`);
    const [clinic] = await tx
      .insert(clinics)
      .values({ id, ...data })
      .returning();
    if (!clinic) throw new Error('Création du cabinet sans résultat');
    return clinic;
  });
}

/**
 * Suspension ou réactivation d'un cabinet (rôle propriétaire). Suspendu : connexion refusée et
 * sessions en cours révoquées à leur requête suivante (auth.service.ts) ; les données restent
 * intactes. Préalable à la restitution et à la purge (docs/operations/fin-de-contrat.md).
 */
export async function setClinicStatus(
  ownerDb: Database,
  clinicId: string,
  status: Clinic['status'],
): Promise<boolean> {
  const updated = await withTenant(ownerDb, clinicId, (tx) =>
    tx
      .update(clinics)
      .set({ status })
      .where(eq(clinics.id, clinicId))
      .returning({ id: clinics.id }),
  );
  return updated.length === 1;
}

/**
 * Conservation pour litige (docs/adr/0014) : posée, elle suspend toute suppression des données
 * du cabinet (purge nocturne, purge après résiliation) ; la date de première pose est gardée.
 */
export async function setLegalHold(
  ownerDb: Database,
  clinicId: string,
  hold: boolean,
  now: Date = new Date(),
): Promise<boolean> {
  const updated = await withTenant(ownerDb, clinicId, (tx) =>
    tx
      .update(clinics)
      .set({ legalHoldSince: hold ? sql`coalesce(${clinics.legalHoldSince}, ${now})` : null })
      .where(eq(clinics.id, clinicId))
      .returning({ id: clinics.id }),
  );
  return updated.length === 1;
}
