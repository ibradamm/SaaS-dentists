import type { LoginRequest, MfaSetupResponse, Role, AuditAction } from '@dental/shared';
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { Logger } from '../../config/logger';
import type { Database, Transaction } from '../../db/client';
import { clinicMemberships, clinics, practitioners, sessions, users } from '../../db/schema';
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
const accountLocked = () =>
  new AppError('ACCOUNT_LOCKED', 'Trop de tentatives. Réessayez dans quelques minutes.', 423);
const attemptInProgress = () =>
  new AppError('RATE_LIMITED', 'Trop de requêtes, réessayer plus tard', 429);

/**
 * Une seule tentative d'authentification à la fois par adresse e-mail (docs/adr/0011) : une
 * tentative simultanée est refusée sans être évaluée, sinon des requêtes parallèles liraient
 * toutes le compteur avant qu'aucun échec ne soit enregistré et contourneraient le
 * verrouillage. Le verrou porte sur l'adresse, que le compte existe ou non : la réponse ne
 * révèle pas l'existence du compte. Il est libéré à la fin de la transaction.
 */
async function lockAttempts(tx: Transaction, email: string): Promise<void> {
  const rows = await tx.execute<{ acquired: boolean }>(
    sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${`auth:${email}`}, 0)) AS acquired`,
  );
  if (!rows.rows[0]?.acquired) throw attemptInProgress();
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(deps: AuthServiceDeps) {
  const { db, secretBox, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const issuer = deps.mfaIssuer ?? 'Cabinet dentaire';

  function audit(
    tx: Transaction,
    userId: string,
    action: AuditAction,
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
  async function auditInUserClinics(userId: string, action: AuditAction, meta: RequestMeta) {
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

  const isLocked = (user: { lockedUntil: Date | null }) =>
    user.lockedUntil !== null && user.lockedUntil > now();

  /**
   * Compte un échec (mot de passe ou code TOTP) : au seuil, le compte est verrouillé et le
   * compteur repart à zéro. Écrit dans la transaction de la tentative, validée avant l'erreur.
   */
  async function countFailure(tx: Transaction, userId: string): Promise<boolean> {
    const lockUntil = minutes(now(), P.loginLockMinutes).toISOString();
    const [row] = await tx
      .update(users)
      .set({
        failedLoginCount: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${P.loginMaxFailures} THEN 0 ELSE ${users.failedLoginCount} + 1 END`,
        lockedUntil: sql`CASE WHEN ${users.failedLoginCount} + 1 >= ${P.loginMaxFailures} THEN ${lockUntil}::timestamptz ELSE ${users.lockedUntil} END`,
      })
      .where(eq(users.id, userId))
      .returning({ lockedUntil: users.lockedUntil });
    return row ? isLocked(row) : false;
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
    // Lecture du compte, vérification du mot de passe et compteur d'échecs dans une même
    // transaction, sous le verrou de tentative : les tentatives sur un compte sont évaluées
    // l'une après l'autre.
    const attempt = await withDbContext(db, { authEmail: input.email }, async (tx) => {
      await lockAttempts(tx, input.email);
      const [user] = await tx.select().from(users).where(eq(users.email, input.email));
      if (!user) {
        // Même durée qu'un compte existant, verrou compris : ni le temps de réponse ni un refus
        // pour tentative simultanée ne révèlent l'existence du compte.
        await verifyAgainstDummy(input.password);
        return { kind: 'unknown' as const };
      }
      if (isLocked(user)) return { kind: 'locked' as const };
      const passwordOk = await verifyPassword(user.passwordHash, input.password);
      if (!passwordOk || user.status !== 'ACTIVE') {
        return { kind: 'failed' as const, user, lockedNow: await countFailure(tx, user.id) };
      }
      // Mot de passe temporaire correct mais expiré : refus explicite (le mot de passe était
      // juste, ce n'est pas un essai à compter), sans remise à zéro du compteur.
      const temporaryUntil =
        user.passwordChangedAt.getTime() + P.temporaryPasswordHours * 3_600_000;
      if (user.mustChangePassword && now().getTime() >= temporaryUntil) {
        return { kind: 'expired' as const, user };
      }
      // Sans second facteur, la connexion est complète : le compteur repart à zéro. Avec un
      // second facteur, il ne repart à zéro qu'après le bon code ; sinon, connaître le mot de
      // passe suffirait à effacer les codes faux et à en essayer sans limite.
      if (!user.mfaEnabledAt) {
        await tx
          .update(users)
          .set({ failedLoginCount: 0, lockedUntil: null })
          .where(eq(users.id, user.id));
      }
      return { kind: 'accepted' as const, user };
    });
    if (attempt.kind === 'unknown') {
      logger.warn({ ip: meta.ip, requestId: meta.requestId }, 'connexion refusée : compte inconnu');
      throw invalidCredentials();
    }
    if (attempt.kind === 'locked') throw accountLocked();
    if (attempt.kind === 'expired') {
      await auditInUserClinics(attempt.user.id, 'auth.login_failed', meta);
      logger.warn(
        { userId: attempt.user.id, requestId: meta.requestId },
        'connexion refusée : mot de passe temporaire expiré',
      );
      throw new AppError(
        'TEMPORARY_PASSWORD_EXPIRED',
        "Ce mot de passe temporaire a expiré. Demandez-en un nouveau à l'administrateur du cabinet.",
        401,
      );
    }
    if (attempt.kind === 'failed') {
      await auditInUserClinics(attempt.user.id, 'auth.login_failed', meta);
      if (attempt.lockedNow) await auditInUserClinics(attempt.user.id, 'auth.account_locked', meta);
      throw invalidCredentials();
    }
    const { user } = attempt;

    const memberships = await withDbContext(db, { userId: user.id }, (tx) =>
      tx
        .select({ clinicId: clinicMemberships.clinicId, role: clinicMemberships.role })
        .from(clinicMemberships)
        .where(and(eq(clinicMemberships.userId, user.id), eq(clinicMemberships.status, 'ACTIVE'))),
    );
    const membership = input.clinicId
      ? memberships.find((m) => m.clinicId === input.clinicId)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!membership) {
      if (!input.clinicId && memberships.length > 1) {
        // Mot de passe vérifié : le compte peut connaître ses cabinets (actifs), chacun lu
        // dans son propre contexte.
        const choices: { id: string; name: string }[] = [];
        for (const m of memberships) {
          const [clinic] = await withTenant(db, m.clinicId, (tx) =>
            tx
              .select({ id: clinics.id, name: clinics.name, status: clinics.status })
              .from(clinics)
              .where(eq(clinics.id, m.clinicId)),
          );
          if (clinic?.status === 'ACTIVE') choices.push({ id: clinic.id, name: clinic.name });
        }
        choices.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        throw new AppError(
          'CLINIC_SELECTION_REQUIRED',
          'Choisissez le cabinet',
          409,
          undefined,
          choices,
        );
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
          // Qualité de praticien (E18) : relue à chaque requête, un archivage prend effet aussitôt.
          isPractitioner: sql<boolean>`exists (
            select 1 from ${practitioners}
            where ${practitioners.clinicId} = ${clinicMemberships.clinicId}
              and ${practitioners.userId} = ${clinicMemberships.userId}
              and ${practitioners.status} = 'ACTIVE')`,
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
          isPractitioner: row.isPractitioner,
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
      await lockAttempts(tx, session.user.email);
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!user?.mfaSecretEnc || !user.mfaEnabledAt) return { ok: false as const, revoked: false };
      // Compte verrouillé (trop d'échecs, y compris depuis d'autres sessions) : aucun code,
      // même juste, n'est évalué.
      if (isLocked(user)) return { ok: false as const, revoked: false, locked: true };
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
              .set({
                mfaLastTimeStep: check.timeStep,
                lastLoginAt: now(),
                failedLoginCount: 0,
                lockedUntil: null,
              })
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
        // Un code faux compte aussi pour le compte : ouvrir de nouvelles sessions ne donne
        // pas de nouveaux essais.
        const lockedNow = await countFailure(tx, userId);
        await audit(tx, userId, 'auth.mfa_failed', meta);
        if (lockedNow) await audit(tx, userId, 'auth.account_locked', meta);
        return { ok: false as const, revoked };
      }
      const rotated = await rotateSession(tx, session.sessionId, { state: 'ACTIVE' });
      await audit(tx, userId, 'auth.login_succeeded', meta);
      return { ok: true as const, rotated, user };
    });
    if (!outcome.ok) {
      if ('locked' in outcome) throw accountLocked();
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
