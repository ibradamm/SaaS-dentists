import { readinessResponseSchema, type ReadinessResponse } from '@dental/shared';

/**
 * Client HTTP minimal. Toute réponse est validée par le contrat partagé : une réponse
 * inattendue est traitée comme une erreur, jamais affichée telle quelle.
 */
export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  const response = await fetch('/health/ready', {
    signal: signal ?? null,
    headers: { accept: 'application/json' },
  });
  return readinessResponseSchema.parse(await response.json());
}
