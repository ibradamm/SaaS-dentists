import { randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { newPasswordSchema } from '@dental/shared';
import { AppError } from '../../lib/errors';
import { SECURITY_POLICY } from './security-policy';

// Algorithme par défaut de @node-rs/argon2 : Argon2id (vérifié par test : préfixe $argon2id$).
const OPTIONS = SECURITY_POLICY.argon2;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Empreinte illisible : traité comme un échec, jamais comme une exception exposée.
    return false;
  }
}

// Empreinte factice : vérifiée quand le compte n'existe pas, pour que la durée de réponse ne
// révèle pas l'existence d'un e-mail.
let dummyHash: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(await dummyHash, password);
}

/** Règles d'un nouveau mot de passe (longueur, différent de l'e-mail et de l'ancien). */
export function assertAcceptableNewPassword(
  password: string,
  context: { email: string; currentPassword?: string },
): void {
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsed.error.issues[0]?.message ?? 'Mot de passe invalide',
      400,
    );
  }
  if (password.toLowerCase() === context.email.toLowerCase()) {
    throw new AppError(
      'VALIDATION_FAILED',
      "Le mot de passe ne peut pas être l'adresse e-mail",
      400,
    );
  }
  if (context.currentPassword !== undefined && password === context.currentPassword) {
    throw new AppError(
      'VALIDATION_FAILED',
      "Le nouveau mot de passe doit différer de l'actuel",
      400,
    );
  }
}

const TEMPORARY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Mot de passe temporaire lisible (sans caractères ambigus), 16 caractères, ~92 bits. */
export function generateTemporaryPassword(length = 16): string {
  let out = '';
  for (let i = 0; i < length; i++) out += TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)];
  return out;
}
