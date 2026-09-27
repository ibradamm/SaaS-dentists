import { describe, expect, it } from 'vitest';
import { createLogger, scrubErrorMessage, serializeError } from '../logger';

describe('journaux : sérialisation des erreurs', () => {
  it('retire les valeurs citées et les adresses e-mail, tronque les messages longs', () => {
    expect(scrubErrorMessage('invalid input syntax for type integer: "Dupont"')).toBe(
      'invalid input syntax for type integer: "[…]"',
    );
    expect(scrubErrorMessage(`Unexpected token 'D', "Dupont" is not valid JSON`)).toBe(
      `Unexpected token '[…]', "[…]" is not valid JSON`,
    );
    expect(scrubErrorMessage('envoi refusé pour lea.dupont@example.org')).toBe(
      'envoi refusé pour [e-mail]',
    );
    expect(scrubErrorMessage('x'.repeat(2000))).toHaveLength(500);
  });

  it('liste blanche : ni detail, ni params, ni propriété inconnue ; pile sans le message brut', () => {
    const pg = Object.assign(new Error('duplicate key value violates unique constraint "u"'), {
      code: '23505',
      constraint: 'users_email_key',
      table: 'users',
      detail: 'Key (email)=(lea.dupont@example.org) already exists.',
      where: 'SQL function',
      patient: { lastName: 'Dupont' },
    });
    const drizzle = Object.assign(new Error('Failed query: select $1\nparams: Dupont'), {
      query: 'select $1',
      params: ['Dupont'],
      cause: pg,
    });
    const out = serializeError(drizzle) as Record<string, unknown>;
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/Dupont|dupont|SQL function/);
    expect(out).toMatchObject({
      type: 'Error',
      message: 'Failed query: select $1',
      cause: { code: '23505', constraint: 'users_email_key', table: 'users' },
    });
    expect(String(out.stack)).toMatch(/^Error: Failed query: select \$1\n\s+at /);
  });

  it('valeurs levées qui ne sont pas des Error ; causes en chaîne limitées', () => {
    expect(serializeError('patient "Dupont" introuvable')).toEqual({
      type: 'string',
      message: 'patient "[…]" introuvable',
    });
    expect(serializeError({ lastName: 'Dupont' })).toEqual({ type: 'object' });
    let chain: Error = new Error('racine');
    for (let i = 0; i < 10; i++) chain = new Error(`niveau ${i}`, { cause: chain });
    const depth = (v: unknown): number =>
      v && typeof v === 'object' && 'cause' in v ? 1 + depth(v.cause) : 0;
    expect(depth(serializeError(chain))).toBe(3);
  });

  it('le logger applique le sérialiseur aux clés err et error', () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: 'test',
      env: 'test',
      level: 'info',
      destination: { write: (line: string) => void lines.push(line) },
    });
    const error = Object.assign(new Error('valeur "Dupont"'), { params: ['Dupont'] });
    logger.error({ err: error }, 'a');
    logger.error({ error }, 'b');
    logger.error(error, 'c');
    expect(lines).toHaveLength(3);
    expect(lines.join('')).not.toContain('Dupont');
  });
});
