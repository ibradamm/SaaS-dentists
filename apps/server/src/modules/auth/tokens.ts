import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Jeton aléatoire de 256 bits (base64url, 43 caractères). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isWellFormedToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** Empreinte stockée en base à la place du jeton. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
