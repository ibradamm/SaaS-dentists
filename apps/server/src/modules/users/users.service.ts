import type {
  ClinicUser,
  CreateUserRequest,
  TemporaryPasswordResponse,
  UpdateUserRequest,
} from '@dental/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Database, Transaction } from '../../db/client';
import { clinicMemberships, sessions, users } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import type { RequestMeta, UserActor } from '../auth/auth.types';
import { authorize } from '../auth/authorize';
import { generateTemporaryPassword, hashPassword } from '../auth/password';

export type UsersService = ReturnType<typeof createUsersService>;

const selection = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  role: clinicMemberships.role,
  status: clinicMemberships.status,
  mfaEnabledAt: users.mfaEnabledAt,
  lastLoginAt: users.lastLoginAt,
};

type Row = {
  id: string;
  email: string;
  fullName: string;
  role: ClinicUser['role'];
  status: ClinicUser['status'];
  mfaEnabledAt: Date | null;
  lastLoginAt: Date | null;
};

const toClinicUser = (row: Row): ClinicUser => ({
  id: row.id,
  email: row.email,
  fullName: row.fullName,
  role: row.role,
  status: row.status,
  mfaEnabled: row.mfaEnabledAt !== null,
  lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
});

const notFound = () => new AppError('NOT_FOUND', 'Utilisateur introuvable', 404);

export function createUsersService(deps: { db: Database; now?: () => Date }) {
  const { db } = deps;
  const now = deps.now ?? (() => new Date());

  function audit(
    tx: Transaction,
    actor: UserActor,
    action: string,
    targetId: string,
    meta: RequestMeta,
    changes?: Record<string, { from?: string | null; to?: string | null }>,
  ) {
    return recordAudit(tx, {
      actorType: 'USER',
      actorId: actor.userId,
      action,
      entityType: 'user',
      entityId: targetId,
      changes: changes ?? null,
      requestId: meta.requestId,
      ip: meta.ip,
    });
  }

  async function findMember(
    tx: Transaction,
    clinicId: string,
    userId: string,
  ): Promise<Row | undefined> {
    const [row] = await tx
      .select(selection)
      .from(clinicMemberships)
      .innerJoin(users, eq(users.id, clinicMemberships.userId))
      .where(and(eq(clinicMemberships.clinicId, clinicId), eq(clinicMemberships.userId, userId)));
    return row;
  }

  function revokeSessions(tx: Transaction, clinicId: string, userId: string) {
    return tx
      .update(sessions)
      .set({ revokedAt: now() })
      .where(
        and(
          eq(sessions.clinicId, clinicId),
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
        ),
      );
  }

  function assertNotSelf(actor: UserActor, userId: string) {
    if (actor.userId === userId) {
      throw new AppError(
        'FORBIDDEN',
        'Cette action ne peut pas porter sur votre propre compte',
        403,
      );
    }
  }

  async function list(actor: UserActor): Promise<ClinicUser[]> {
    authorize(actor, 'user.manage');
    const rows = await withTenant(db, actor.clinicId, (tx) =>
      tx
        .select(selection)
        .from(clinicMemberships)
        .innerJoin(users, eq(users.id, clinicMemberships.userId))
        .where(eq(clinicMemberships.clinicId, actor.clinicId))
        .orderBy(asc(users.fullName)),
    );
    return rows.map(toClinicUser);
  }

  async function create(
    actor: UserActor,
    input: CreateUserRequest,
    meta: RequestMeta,
  ): Promise<TemporaryPasswordResponse> {
    authorize(actor, 'user.manage');
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const id = uuidv7();
    try {
      const row = await withTenant(db, actor.clinicId, async (tx) => {
        // Pas de RETURNING : le compte n'est visible qu'une fois l'appartenance créée (RLS).
        await tx.insert(users).values({
          id,
          email: input.email,
          fullName: input.fullName,
          passwordHash,
          mustChangePassword: true,
        });
        await tx.insert(clinicMemberships).values({ userId: id, role: input.role });
        await audit(tx, actor, 'user.created', id, meta, { role: { to: input.role } });
        return findMember(tx, actor.clinicId, id);
      });
      if (!row) throw new Error('Compte créé mais introuvable');
      return { user: toClinicUser(row), temporaryPassword };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError('CONFLICT', 'Un compte existe déjà avec cette adresse e-mail', 409);
      }
      throw error;
    }
  }

  async function update(
    actor: UserActor,
    userId: string,
    input: UpdateUserRequest,
    meta: RequestMeta,
  ): Promise<ClinicUser> {
    authorize(actor, 'user.manage');
    assertNotSelf(actor, userId);
    return withTenant(db, actor.clinicId, async (tx) => {
      // Verrou sur les administrateurs actifs : deux rétrogradations simultanées ne peuvent
      // pas supprimer le dernier administrateur.
      const admins = await tx
        .select({ userId: clinicMemberships.userId })
        .from(clinicMemberships)
        .where(
          and(
            eq(clinicMemberships.clinicId, actor.clinicId),
            eq(clinicMemberships.role, 'ADMIN'),
            eq(clinicMemberships.status, 'ACTIVE'),
          ),
        )
        .for('update');
      const target = await findMember(tx, actor.clinicId, userId);
      if (!target) throw notFound();
      const nextRole = input.role ?? target.role;
      const nextStatus = input.status ?? target.status;
      const removesAdmin =
        target.role === 'ADMIN' &&
        target.status === 'ACTIVE' &&
        (nextRole !== 'ADMIN' || nextStatus !== 'ACTIVE');
      if (removesAdmin && admins.filter((a) => a.userId !== userId).length === 0) {
        throw new AppError(
          'CONFLICT',
          'Le cabinet doit conserver au moins un administrateur actif',
          409,
        );
      }
      await tx
        .update(clinicMemberships)
        .set({ role: nextRole, status: nextStatus })
        .where(
          and(eq(clinicMemberships.clinicId, actor.clinicId), eq(clinicMemberships.userId, userId)),
        );
      // Tout changement de droits ferme les sessions en cours : les nouveaux droits
      // s'appliquent dès la prochaine connexion.
      await revokeSessions(tx, actor.clinicId, userId);
      const changes: Record<string, { from: string; to: string }> = {};
      if (nextRole !== target.role) changes.role = { from: target.role, to: nextRole };
      if (nextStatus !== target.status) changes.status = { from: target.status, to: nextStatus };
      await audit(tx, actor, 'user.access_updated', userId, meta, changes);
      const updated = await findMember(tx, actor.clinicId, userId);
      if (!updated) throw notFound();
      return toClinicUser(updated);
    });
  }

  async function resetPassword(
    actor: UserActor,
    userId: string,
    meta: RequestMeta,
  ): Promise<TemporaryPasswordResponse> {
    authorize(actor, 'user.manage');
    assertNotSelf(actor, userId);
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const row = await withTenant(db, actor.clinicId, async (tx) => {
      const target = await findMember(tx, actor.clinicId, userId);
      if (!target) throw notFound();
      await tx
        .update(users)
        .set({
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: now(),
          failedLoginCount: 0,
          lockedUntil: null,
        })
        .where(eq(users.id, userId));
      await revokeSessions(tx, actor.clinicId, userId);
      await audit(tx, actor, 'user.password_reset', userId, meta);
      return target;
    });
    return { user: toClinicUser(row), temporaryPassword };
  }

  async function resetMfa(
    actor: UserActor,
    userId: string,
    meta: RequestMeta,
  ): Promise<ClinicUser> {
    authorize(actor, 'user.manage');
    assertNotSelf(actor, userId);
    return withTenant(db, actor.clinicId, async (tx) => {
      const target = await findMember(tx, actor.clinicId, userId);
      if (!target) throw notFound();
      await tx
        .update(users)
        .set({ mfaSecretEnc: null, mfaEnabledAt: null, mfaLastTimeStep: null })
        .where(eq(users.id, userId));
      await revokeSessions(tx, actor.clinicId, userId);
      await audit(tx, actor, 'user.mfa_reset', userId, meta);
      return toClinicUser({ ...target, mfaEnabledAt: null });
    });
  }

  return { list, create, update, resetPassword, resetMfa };
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return (error as { code?: string } | null)?.code === '23505' || cause?.code === '23505';
}
