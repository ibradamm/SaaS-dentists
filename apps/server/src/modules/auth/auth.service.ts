import type { LoginRequest, MfaSetupResponse, Role } from '@dental/shared';
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Logger } from '../../config/logger';
import type { Database, Transaction } from '../../db/client';
import { clinicMemberships, clinics, sessions, users, type User } from '../../db/schema';
import { setDbContext, withDbContext, withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import type { SecretBox } from '../../lib/secret-box';
import { recordAudit } from '../audit/audit.service';
import type { AuthenticatedSession, IssuedSession, RequestMeta } from './auth.types';
import {
  assertAcceptableNewPassword,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from './password';
import { computeRestriction } from './restrictions';
import { SECURITY_POLICY as P } from './security-policy';
import { generateToken, hashToken, isWellFormedToken } from './tokens';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from './totp';

export interface AuthServiceDeps {
  db: Database;
  secretBox: SecretBox;
  logger: Logger;
  /** Horloge injectable (tests d'expiration et de verrouillage). */
  now?: () => Date;
  mfaIssuer?: string;
}

const minutes = (date: Date, n: number) => new Date(date.getTime() + n * 60_000);
const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 'Adresse e-mail ou mot de passe incorrect', 401);
const mfaContext = (userId: string) => `users.mfa_secret:${userId}`;

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(deps: AuthServiceDeps) {
  const { db, secretBox, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const issuer = deps.mfaIssuer ?? 'Cabinet dentaire';

  function audit(
    tx: Transaction,
    userId: string,
    action: string,
    meta: RequestMeta,
    entityId?: string,
  ) {
    return recordAudit(tx, {
      actorType: 'USER',
      actorId: userId,
      action,
      entityType: 'user',
      entityId: entityId ?? userId,
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  /** Trace dans chaque cabinet du compte (la connexion n'a pas encore de cabinet). */
  async function auditInUserClinics(userId: string, action: string, meta: RequestMeta) {
    const memberships = await withDbContext(db, { userId }, (tx) =>
      tx
        .select({ clinicId: clinicMemberships.clinicId })
        .from(clinicMemberships)
        .where(eq(clinicMemberships.userId, userId)),
    );
    for (const { clinicId } of memberships) {
      await withTenant(db, clinicId, (tx) => audit(tx, userId, action, meta));
    }
  }

  async function recordLoginFailure(user: User, meta: RequestMeta): Promise<void> {
    const lockUntil = minutes(now(), P.loginLockMinutes).toISOString();
    const [row] = await withDbContext(db, { authEmail: user.email }, (tx) =>
      tx
        .update(users)
        .set({
          failedLoginCount: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${P.loginMaxFailures} THEN 0 ELSE ${users.failedLoginCount} + 1 END`,
          lockedUntil: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${P.loginMaxFailures} THEN ${lockUntil}::timestamptz ELSE ${users.lockedUntil} END`,
        })
        .where(eq(users.id, user.id))
        .returning({ lockedUntil: users.lockedUntil }),
    );
    await auditInUserClinics(user.id, 'auth.login_failed', meta);
    if (row?.lockedUntil && row.lockedUntil > now()) {
      await auditInUserClinics(user.id, 'auth.account_locked', meta);
    }
  }

  async function createSession(
    tx: Transaction,
    input: { userId: string; clinicId: string; state: 'MFA_PENDING' | 'ACTIVE'; meta: RequestMeta },
  ): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    const token = generateToken();
    const csrfToken = generateToken();
    const at = now();
    const expiresAt = minutes(at, P.sessionAbsoluteHours * 60);
    await tx.insert(sessions).values({
      tokenHash: hashToken(token),
      clinicId: input.clinicId,
      userId: input.userId,
      state: input.state,
      csrfToken,
      createdAt: at,
      lastSeenAt: at,
      expiresAt,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    });
    return { token, csrfToken, expiresAt };
  }

  /** Remplace le jeton d'une session (changement de niveau de privilège). */
  async function rotateSession(
    tx: Transaction,
    sessionId: string,
    changes: { state?: 'ACTIVE' } = {},
  ): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
    const token = generateToken();
    const csrfToken = generateToken();
    const [row] = await tx
      .update(sessions)
      .set({ tokenHash: hashToken(token), csrfToken, lastSeenAt: now(), ...changes })
      .where(eq(sessions.id, sessionId))
      .returning({ expiresAt: sessions.expiresAt });
    if (!row) throw new AppError('UNAUTHENTICATED', 'Session introuvable', 401);
    return { token, csrfToken, expiresAt: row.expiresAt };
  }

  async function login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession> {
    const [user] = await withDbContext(db, { authEmail: input.email }, (tx) =>
      tx.select().from(users).where(eq(users.email, input.email)),
    );
    if (!user) {
      await verifyAgainstDummy(input.password);
      logger.warn({ ip: meta.ip, requestId: meta.requestId }, 'connexion refusée : compte inconnu');
      throw invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > now()) {
      throw new AppError(
        'ACCOUNT_LOCKED',
        'Trop de tentatives. Réessayez dans quelques minutes.',
        423,
      );
    }
    const passwordOk = await verifyPassword(user.passwordHash, input.password);
    if (!passwordOk || user.status !== 'ACTIVE') {
      await recordLoginFailure(user, meta);
      throw invalidCredentials();
    }

    const memberships = await withDbContext(db, { userId: user.id }, async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null })
        .where(eq(users.id, user.id));
      return tx
        .select({ clinicId: clinicMemberships.clinicId, role: clinicMemberships.role })
        .from(clinicMemberships)
        .where(and(eq(clinicMemberships.userId, user.id), eq(clinicMemberships.status, 'ACTIVE')));
    });
    const membership = input.clinicId
      ? memberships.find((m) => m.clinicId === input.clinicId)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!membership) {
      if (!input.clinicId && memberships.length > 1) {
        throw new AppError('CLINIC_SELECTION_REQUIRED', 'Choisissez le cabinet', 409);
      }
      throw invalidCredentials();
    }

    const state = user.mfaEnabledAt ? 'MFA_PENDING' : 'ACTIVE';
    const issued = await withTenant(db, membership.clinicId, async (tx) => {
      const [clinic] = await tx
        .select({ status: clinics.status })
        .from(clinics)
        .where(eq(clinics.id, membership.clinicId));
      if (clinic?.status !== 'ACTIVE') return null;
      const created = await createSession(tx, {
        userId: user.id,
        clinicId: membership.clinicId,
        state,
        meta,
      });
      if (state === 'ACTIVE') {
        await tx.update(users).set({ lastLoginAt: now() }).where(eq(users.id, user.id));
        await audit(tx, user.id, 'auth.login_succeeded', meta);
      }
      return created;
    });
    if (!issued) throw invalidCredentials();
    return { ...issued, restriction: computeRestriction(state, user, membership.role) };
  }

  async function resolveSession(token: string): Promise<AuthenticatedSession | null> {
    if (!isWellFormedToken(token)) return null;
    const tokenHash = hashToken(token);
    return withDbContext(db, { sessionTokenHash: tokenHash }, async (tx) => {
      const [session] = await tx.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
      if (!session || session.revokedAt) return null;
      const at = now();
      const idleLimit = minutes(session.lastSeenAt, P.sessionIdleMinutes);
      const pendingLimit = minutes(session.createdAt, P.mfaPendingMinutes);
      const expired =
        at >= session.expiresAt ||
        at >= idleLimit ||
        (session.state === 'MFA_PENDING' && at >= pendingLimit);
      if (expired) {
        await tx.update(sessions).set({ revokedAt: at }).where(eq(sessions.id, session.id));
        return null;
      }

      await setDbContext(tx, { clinicId: session.clinicId });
      const [row] = await tx
        .select({
          user: users,
          role: clinicMemberships.role,
          membershipStatus: clinicMemberships.status,
          clinic: clinics,
        })
        .from(clinicMemberships)
        .innerJoin(users, eq(users.id, clinicMemberships.userId))
        .innerJoin(clinics, eq(clinics.id, clinicMemberships.clinicId))
        .where(
          and(
            eq(clinicMemberships.clinicId, session.clinicId),
            eq(clinicMemberships.userId, session.userId),
          ),
        );
      if (
        !row ||
        row.membershipStatus !== 'ACTIVE' ||
        row.user.status !== 'ACTIVE' ||
        row.clinic.status !== 'ACTIVE'
      ) {
        await tx.update(sessions).set({ revokedAt: at }).where(eq(sessions.id, session.id));
        return null;
      }
      if (at.getTime() - session.lastSeenAt.getTime() >= P.sessionTouchSeconds * 1000) {
        await tx.update(sessions).set({ lastSeenAt: at }).where(eq(sessions.id, session.id));
      }
      const role: Role = row.role;
      return {
        sessionId: session.id,
        state: session.state,
        csrfToken: session.csrfToken,
        restriction: computeRestriction(session.state, row.user, role),
        actor: {
          kind: 'USER',
          userId: row.user.id,
          clinicId: session.clinicId,
          role,
          sessionId: session.id,
        },
        user: {
          id: row.user.id,
          email: row.user.email,
          fullName: row.user.fullName,
          mfaEnabled: row.user.mfaEnabledAt !== null,
        },
        clinic: { id: row.clinic.id, name: row.clinic.name },
      };
    });
  }

  async function verifyMfa(
    session: AuthenticatedSession,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    if (session.state !== 'MFA_PENDING') {
      throw new AppError('BAD_REQUEST', 'Aucune vérification en attente', 400);
    }
    const { userId, clinicId } = session.actor;
    // La transaction est validée même en cas d'échec (compteur de tentatives) ; l'erreur est
    // levée après.
    const outcome = await withTenant(db, clinicId, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!user?.mfaSecretEnc || !user.mfaEnabledAt) return { ok: false as const, revoked: false };
      const check = await verifyTotp({
        secret: secretBox.decrypt(user.mfaSecretEnc, mfaContext(userId)),
        code,
        afterTimeStep: user.mfaLastTimeStep,
        epochSeconds: Math.floor(now().getTime() / 1000),
      });
      // Mise à jour conditionnelle : deux requêtes simultanées avec le même code ne peuvent
      // pas réussir toutes les deux.
      const accepted =
        check.valid && check.timeStep !== undefined
          ? await tx
              .update(users)
              .set({ mfaLastTimeStep: check.timeStep, lastLoginAt: now() })
              .where(
                and(
                  eq(users.id, userId),
                  or(isNull(users.mfaLastTimeStep), lt(users.mfaLastTimeStep, check.timeStep)),
                ),
              )
              .returning({ id: users.id })
          : [];
      if (accepted.length === 0) {
        const [updated] = await tx
          .update(sessions)
          .set({ mfaAttempts: sql`${sessions.mfaAttempts} + 1` })
          .where(eq(sessions.id, session.sessionId))
          .returning({ attempts: sessions.mfaAttempts });
        const revoked = (updated?.attempts ?? P.mfaMaxAttempts) >= P.mfaMaxAttempts;
        if (revoked) {
          await tx
            .update(sessions)
            .set({ revokedAt: now() })
            .where(eq(sessions.id, session.sessionId));
        }
        await audit(tx, userId, 'auth.mfa_failed', meta);
        return { ok: false as const, revoked };
      }
      const rotated = await rotateSession(tx, session.sessionId, { state: 'ACTIVE' });
      await audit(tx, userId, 'auth.login_succeeded', meta);
      return { ok: true as const, rotated, user };
    });
    if (!outcome.ok) {
      if (outcome.revoked)
        throw new AppError('UNAUTHENTICATED', 'Trop de tentatives, reconnectez-vous', 401);
      throw new AppError('INVALID_MFA_CODE', 'Code invalide ou déjà utilisé', 401);
    }
    return {
      ...outcome.rotated,
      restriction: computeRestriction('ACTIVE', outcome.user, session.actor.role),
    };
  }

  async function logout(session: AuthenticatedSession, meta: RequestMeta): Promise<void> {
    await withTenant(db, session.actor.clinicId, async (tx) => {
      await tx.update(sessions).set({ revokedAt: now() }).where(eq(sessions.id, session.sessionId));
      await audit(tx, session.actor.userId, 'auth.logout', meta);
    });
  }

  async function changePassword(
    session: AuthenticatedSession,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const { userId, clinicId, role } = session.actor;
    const [user] = await withTenant(db, clinicId, (tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect', 401);
    }
    assertAcceptableNewPassword(input.newPassword, {
      email: user.email,
      currentPassword: input.currentPassword,
    });
    const passwordHash = await hashPassword(input.newPassword);
    const rotated = await withTenant(db, clinicId, async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: false, passwordChangedAt: now() })
        .where(eq(users.id, userId));
      // Les autres sessions du compte dans ce cabinet sont fermées.
      await tx
        .update(sessions)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(sessions.clinicId, clinicId),
            eq(sessions.userId, userId),
            ne(sessions.id, session.sessionId),
            isNull(sessions.revokedAt),
          ),
        );
      await audit(tx, userId, 'auth.password_changed', meta);
      return rotateSession(tx, session.sessionId);
    });
    return {
      ...rotated,
      restriction: computeRestriction(session.state, { ...user, mustChangePassword: false }, role),
    };
  }

  async function setupMfa(session: AuthenticatedSession): Promise<MfaSetupResponse> {
    if (session.user.mfaEnabled) {
      throw new AppError('CONFLICT', 'La double authentification est déjà active', 409);
    }
    const secret = generateTotpSecret();
    await withTenant(db, session.actor.clinicId, (tx) =>
      tx
        .update(users)
        .set({ mfaSecretEnc: secretBox.encrypt(secret, mfaContext(session.actor.userId)) })
        .where(eq(users.id, session.actor.userId)),
    );
    return {
      secret,
      otpauthUri: buildOtpauthUri({ issuer, account: session.user.email, secret }),
    };
  }

  async function activateMfa(
    session: AuthenticatedSession,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const { userId, clinicId, role } = session.actor;
    const outcome = await withTenant(db, clinicId, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!user?.mfaSecretEnc || user.mfaEnabledAt) return null;
      const check = await verifyTotp({
        secret: secretBox.decrypt(user.mfaSecretEnc, mfaContext(userId)),
        code,
        afterTimeStep: null,
        epochSeconds: Math.floor(now().getTime() / 1000),
      });
      if (!check.valid || check.timeStep === undefined) return null;
      const enabledAt = now();
      await tx
        .update(users)
        .set({ mfaEnabledAt: enabledAt, mfaLastTimeStep: check.timeStep })
        .where(eq(users.id, userId));
      await audit(tx, userId, 'auth.mfa_enabled', meta);
      const rotated = await rotateSession(tx, session.sessionId);
      return { rotated, user: { ...user, mfaEnabledAt: enabledAt } };
    });
    if (!outcome) throw new AppError('INVALID_MFA_CODE', 'Code invalide', 401);
    return {
      ...outcome.rotated,
      restriction: computeRestriction(session.state, outcome.user, role),
    };
  }

  return { login, resolveSession, verifyMfa, logout, changePassword, setupMfa, activateMfa };
}
