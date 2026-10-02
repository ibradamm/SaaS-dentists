import { z } from 'zod';

export const healthCheckStatusSchema = z.enum(['ok', 'error']);

export const readinessResponseSchema = z.object({
  status: healthCheckStatusSchema,
  checks: z.object({
    database: healthCheckStatusSchema,
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
