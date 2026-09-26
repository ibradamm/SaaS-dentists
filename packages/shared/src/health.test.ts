import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from './errors';
import { readinessResponseSchema } from './health';

describe('contrats partagés', () => {
  it('accepte une réponse de disponibilité valide', () => {
    const parsed = readinessResponseSchema.parse({ status: 'ok', checks: { database: 'ok' } });
    expect(parsed.checks.database).toBe('ok');
  });

  it('rejette un statut inconnu', () => {
    expect(() =>
      readinessResponseSchema.parse({ status: 'degraded', checks: { database: 'ok' } }),
    ).toThrow();
  });

  it("rejette un code d'erreur hors catalogue", () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'OOPS', message: 'x' } }).success).toBe(false);
  });
});
