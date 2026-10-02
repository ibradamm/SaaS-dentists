import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement applicatif des champs très sensibles (AES-256-GCM, authentifié).
 * Format : v1.<iv>.<chiffré>.<tag> (base64url). Le contexte (AAD) lie le chiffré à son usage
 * et à sa ligne : un secret copié vers un autre compte ne se déchiffre pas.
 */
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

export interface SecretBox {
  encrypt(plaintext: string, context: string): string;
  decrypt(sealed: string, context: string): string;
}

export function parseEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('La clé de chiffrement doit faire 32 octets (base64)');
  return key;
}

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error('La clé de chiffrement doit faire 32 octets');
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, iv, encrypted, cipher.getAuthTag()]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },
    decrypt(sealed, context) {
      const [version, iv, encrypted, tag] = sealed.split('.');
      if (version !== VERSION || !iv || !encrypted || !tag) {
        throw new Error('Format de donnée chiffrée inconnu');
      }
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
