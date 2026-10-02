import type { Role } from '@dental/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { META, createTestAuth, createUser, uniqueEmail } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import { clinicMemberships, type Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import type { UserActor } from '../../auth/auth.types';
import { createUsersService } from '../users.service';

describe('gestion des utilisateurs', () => {
  const t = openTestDatabase();
  const service = createUsersService({ db: t.appDb });
  let clinic: Clinic;
  let otherClinic: Clinic;
  let admin: UserActor;

  const actorFor = (userId: string, role: Role, clinicId = clinic.id): UserActor => ({
    kind: 'USER',
    userId,
    clinicId,
    role,
    isPractitioner: false,
    sessionId: '00000000-0000-7000-8000-000000000000',
  });

  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
    otherClinic = await createTestClinic(t.ownerDb);
    const a = await createUser(t.ownerDb, clinic.id, 'ADMIN');
    admin = actorFor(a.id, 'ADMIN');
  });
  afterAll(() => t.close());

  it('un administrateur crée un compte ; le mot de passe temporaire impose un changement', async () => {
    const { auth } = createTestAuth(t.appDb);
    const email = uniqueEmail('nouveau');
    const created = await service.create(
      admin,
      { email, fullName: 'Nouvelle Secrétaire', role: 'SECRETARY' },
      META,
    );
    expect(created.user).toMatchObject({
      email,
      role: 'SECRETARY',
      status: 'ACTIVE',
      mfaEnabled: false,
    });
    expect(created.temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
    const issued = await auth.login({ email, password: created.temporaryPassword }, META);
    expect(issued.restriction).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await service.list(admin)).map((u) => u.email)).toContain(email);
  });

  it('refuse une adresse e-mail déjà utilisée', async () => {
    const existing = await createUser(t.ownerDb, otherClinic.id, 'SECRETARY');
    await expect(
      service.create(
        admin,
        { email: existing.email, fullName: 'Doublon', role: 'SECRETARY' },
        META,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });
  });

  it("ne liste que les membres du cabinet de l'acteur", async () => {
    const outsider = await createUser(t.ownerDb, otherClinic.id, 'DENTIST');
    const ids = (await service.list(admin)).map((u) => u.id);
    expect(ids).not.toContain(outsider.id);
  });

  it("ne peut pas modifier un compte d'un autre cabinet", async () => {
    const outsider = await createUser(t.ownerDb, otherClinic.id, 'SECRETARY');
    await expect(
      service.update(admin, outsider.id, { status: 'DISABLED' }, META),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(service.resetPassword(admin, outsider.id, META)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each(['DENTIST', 'SECRETARY'] as const)(
    '%s ne peut effectuer aucune opération de gestion',
    async (role) => {
      const u = await createUser(t.ownerDb, clinic.id, role);
      const target = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      const actor = actorFor(u.id, role);
      const forbidden = { code: 'FORBIDDEN', statusCode: 403 };
      await expect(service.list(actor)).rejects.toMatchObject(forbidden);
      await expect(
        service.create(actor, { email: uniqueEmail(), fullName: 'X', role: 'ADMIN' }, META),
      ).rejects.toMatchObject(forbidden);
      await expect(service.update(actor, target.id, { role: 'ADMIN' }, META)).rejects.toMatchObject(
        forbidden,
      );
      await expect(service.resetPassword(actor, target.id, META)).rejects.toMatchObject(forbidden);
      await expect(service.resetMfa(actor, target.id, META)).rejects.toMatchObject(forbidden);
    },
  );

  it('un administrateur ne peut pas modifier son propre compte par cette voie', async () => {
    await expect(
      service.update(admin, admin.userId, { role: 'SECRETARY' }, META),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('un changement de rôle ferme les sessions du compte concerné', async () => {
    const { auth } = createTestAuth(t.appDb);
    const target = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
    const issued = await auth.login({ email: target.email, password: target.password }, META);
    const updated = await service.update(admin, target.id, { role: 'DENTIST' }, META);
    expect(updated.role).toBe('DENTIST');
    expect(await auth.resolveSession(issued.token)).toBeNull();
  });

  it('la réinitialisation du mot de passe invalide l’ancien et ferme les sessions', async () => {
    const { auth } = createTestAuth(t.appDb);
    const target = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
    const issued = await auth.login({ email: target.email, password: target.password }, META);
    const { temporaryPassword } = await service.resetPassword(admin, target.id, META);
    expect(await auth.resolveSession(issued.token)).toBeNull();
    await expect(
      auth.login({ email: target.email, password: target.password }, META),
    ).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(
      auth.login({ email: target.email, password: temporaryPassword }, META),
    ).resolves.toMatchObject({
      restriction: 'PASSWORD_CHANGE_REQUIRED',
    });
  });

  it('deux administrateurs qui se rétrogradent simultanément : un seul y parvient', async () => {
    const isolated = await createTestClinic(t.ownerDb);
    const a1 = await createUser(t.ownerDb, isolated.id, 'ADMIN');
    const a2 = await createUser(t.ownerDb, isolated.id, 'ADMIN');
    const results = await Promise.allSettled([
      service.update(actorFor(a1.id, 'ADMIN', isolated.id), a2.id, { role: 'SECRETARY' }, META),
      service.update(actorFor(a2.id, 'ADMIN', isolated.id), a1.id, { role: 'SECRETARY' }, META),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'CONFLICT' });
    const admins = await withTenant(t.appDb, isolated.id, (tx) =>
      tx
        .select()
        .from(clinicMemberships)
        .where(and(eq(clinicMemberships.role, 'ADMIN'), eq(clinicMemberships.status, 'ACTIVE'))),
    );
    expect(admins).toHaveLength(1);
  });
});
