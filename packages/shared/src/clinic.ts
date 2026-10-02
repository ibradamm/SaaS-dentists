import { z } from 'zod';

export const clinicResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
  countryCode: z.string(),
  // Coordonnées du cabinet (facultatives), téléphone au format E.164.
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export type ClinicResponse = z.infer<typeof clinicResponseSchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const updateClinicRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().min(1).max(64).optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .optional(),
    addressLine1: optionalText(200),
    addressLine2: optionalText(200),
    postalCode: optionalText(20),
    city: optionalText(100),
    phone: optionalText(32),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Aucune modification demandée');
export type UpdateClinicRequest = z.infer<typeof updateClinicRequestSchema>;
