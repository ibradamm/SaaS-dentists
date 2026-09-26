import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { isValidTimeZone } from '../../lib/time';
import type { Database } from '../client';
import { clinics, type Clinic } from '../schema';

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
