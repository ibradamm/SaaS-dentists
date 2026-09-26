import { z } from 'zod';

export const clinicResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
  countryCode: z.string(),
});
export type ClinicResponse = z.infer<typeof clinicResponseSchema>;

export const updateClinicRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    timezone: z.string().min(1).max(64).optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Aucune modification demandée');
export type UpdateClinicRequest = z.infer<typeof updateClinicRequestSchema>;
