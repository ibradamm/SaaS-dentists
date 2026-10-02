import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretBox, parseEncryptionKey } from '../secret-box';

describe('chiffrement des secrets (AES-256-GCM)', () => {
  const box = createSecretBox(randomBytes(32));

  it('déchiffre ce qu’il chiffre, avec le même contexte', () => {
    const sealed = box.encrypt('JBSWY3DPEHPK3PXP', 'users.mfa_secret:u1');
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.decrypt(sealed, 'users.mfa_secret:u1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('deux chiffrements du même texte diffèrent (IV aléatoire)', () => {
    expect(box.encrypt('x', 'c')).not.toBe(box.encrypt('x', 'c'));
  });

  it('refuse un autre contexte : un secret copié sur un autre compte est illisible', () => {
    const sealed = box.encrypt('secret', 'users.mfa_secret:u1');
    expect(() => box.decrypt(sealed, 'users.mfa_secret:u2')).toThrow();
  });

  it('refuse une donnée altérée', () => {
    const sealed = box.encrypt('secret', 'c');
    const parts = sealed.split('.');
    parts[2] = Buffer.from('autre').toString('base64url');
    expect(() => box.decrypt(parts.join('.'), 'c')).toThrow();
  });

  it('refuse une autre clé', () => {
    const sealed = box.encrypt('secret', 'c');
    expect(() => createSecretBox(randomBytes(32)).decrypt(sealed, 'c')).toThrow();
  });

  it('exige une clé de 32 octets', () => {
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow();
    expect(parseEncryptionKey(Buffer.alloc(32).toString('base64'))).toHaveLength(32);
  });
});
