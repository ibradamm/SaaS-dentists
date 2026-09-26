import { describe, expect, it } from 'vitest';
import {
  assertAcceptableNewPassword,
  generateTemporaryPassword,
  hashPassword,
  verifyPassword,
} from '../password';

describe('mots de passe', () => {
  it('empreinte Argon2id, vérification correcte', async () => {
    const hash = await hashPassword('une phrase de passe correcte');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword(hash, 'une phrase de passe correcte')).toBe(true);
    expect(await verifyPassword(hash, 'une phrase de passe incorrecte')).toBe(false);
  });

  it('une empreinte illisible est un échec, pas une exception', async () => {
    expect(await verifyPassword('pas-une-empreinte', 'x')).toBe(false);
  });

  it('règles du nouveau mot de passe', () => {
    const ctx = { email: 'moi@cabinet.test', currentPassword: 'ancien mot de passe' };
    expect(() => assertAcceptableNewPassword('court', ctx)).toThrow();
    expect(() => assertAcceptableNewPassword('MOI@cabinet.test', ctx)).toThrow();
    expect(() => assertAcceptableNewPassword('ancien mot de passe', ctx)).toThrow();
    expect(() => assertAcceptableNewPassword('x'.repeat(129), ctx)).toThrow();
    expect(() => assertAcceptableNewPassword('une phrase suffisamment longue', ctx)).not.toThrow();
  });

  it('mot de passe temporaire : 16 caractères sans ambiguïté, tous différents', () => {
    const values = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()));
    expect(values.size).toBe(200);
    for (const v of values) expect(v).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
  });
});
