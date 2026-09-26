/** Codes SQLSTATE utilisés pour traduire une violation de contrainte en erreur métier. */
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_EXCLUSION_VIOLATION = '23P01';

/** Code SQLSTATE d'une erreur PostgreSQL, directe ou enveloppée par Drizzle (`cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  const direct = (error as { code?: unknown } | null)?.code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof cause === 'string' ? cause : undefined;
}
