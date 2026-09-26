import { randomBytes } from 'node:crypto';
import type { Role } from '@dental/shared';
import { eq } from 'drizzle-orm';
import { generate, generateSecret } from 'otplib';
import { pino } from 'pino';
import { provisionUser } from '../src/db/admin/users';
import type { Database } from '../src/db/client';
import { users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import type { RequestMeta } from '../src/modules/auth/auth.types';
import { createAuthService } from '../src/modules/auth/auth.service';
import { createSecretBox, type SecretBox } from '../src/lib/secret-box';

export const TEST_PASSWORD = 'mot-de-passe-de-test-1';
export const META: RequestMeta = {
  ip: '203.0.113.10',
  userAgent: 'vitest',
  requestId: 'test-request',
};

/** Horloge contrôlée par les tests (expirations, verrouillage, TOTP). */
export function testClock(start = new Date('2026-09-28T08:00:00Z')) {
  let current = start;
  return {
    now: () => current,
    advanceMinutes(n: number) {
      current = new Date(current.getTime() + n * 60_000);
    },
    advanceSeconds(n: number) {
      current = new Date(current.getTime() + n * 1_000);
    },
    epochSeconds: () => Math.floor(current.getTime() / 1000),
  };
}

export function createTestAuth(appDb: Database, clock = testClock()) {
  const secretBox = createSecretBox(randomBytes(32));
  const auth = createAuthService({
    db: appDb,
    secretBox,
    logger: pino({ level: 'silent' }),
    now: clock.now,
  });
  return { auth, clock, secretBox };
}

export function uniqueEmail(prefix = 'user') {
  return `${prefix}.${randomBytes(4).toString('hex')}@cabinet.test`;
}

export async function createUser(
  ownerDb: Database,
  clinicId: string,
  role: Role,
  options: { mustChangePassword?: boolean; email?: string } = {},
) {
  const email = options.email ?? uniqueEmail(role.toLowerCase());
  const id = await provisionUser(ownerDb, {
    clinicId,
    email,
    fullName: `Test ${role}`,
    role,
    password: TEST_PASSWORD,
    mustChangePassword: options.mustChangePassword ?? false,
  });
  return { id, email, password: TEST_PASSWORD };
}

export function totpAt(secret: string, epochSeconds: number): Promise<string> {
  return generate({ secret, epoch: epochSeconds });
}

/** Active directement la double authentification d'un compte (préparation de test). */
export async function enableMfa(
  ownerDb: Database,
  clinicId: string,
  userId: string,
  secretBox: SecretBox,
): Promise<string> {
  const secret = generateSecret();
  await withTenant(ownerDb, clinicId, (tx) =>
    tx
      .update(users)
      .set({
        mfaSecretEnc: secretBox.encrypt(secret, `users.mfa_secret:${userId}`),
        mfaEnabledAt: new Date(),
      })
      .where(eq(users.id, userId)),
  );
  return secret;
}
