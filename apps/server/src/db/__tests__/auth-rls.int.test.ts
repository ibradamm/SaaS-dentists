import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { META, createTestAuth, createUser } from '../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../test/db';
import { hashToken } from '../../modules/auth/tokens';
import { clinicMemberships, sessions, users, type Clinic } from '../schema';
import { withDbContext, withTenant } from '../tenant';

describe('isolation des tables d’authentification (RLS)', () => {
  const t = openTestDatabase();
  let a: Clinic;
  let b: Clinic;
  let userA: { id: string; email: string; password: string };
  let userB: { id: string; email: string; password: string };
  let both: { id: string; email: string };
  let tokenA: string;

  beforeAll(async () => {
    a = await createTestClinic(t.ownerDb);
    b = await createTestClinic(t.ownerDb);
    userA = await createUser(t.ownerDb, a.id, 'SECRETARY');
    userB = await createUser(t.ownerDb, b.id, 'SECRETARY');
    // Un même compte membre des deux cabinets.
    both = await createUser(t.ownerDb, a.id, 'DENTIST');
    await withTenant(t.ownerDb, b.id, (tx) =>
      tx.insert(clinicMemberships).values({ userId: both.id, role: 'SECRETARY' }),
    );
    const { auth } = createTestAuth(t.appDb);
    tokenA = (await auth.login({ email: userA.email, password: userA.password }, META)).token;
    await auth.login({ email: userB.email, password: userB.password }, META);
  });
  afterAll(() => t.close());

  it('sans contexte : aucun compte, aucune appartenance, aucune session', async () => {
    expect(await t.appDb.select().from(users)).toEqual([]);
    expect(await t.appDb.select().from(clinicMemberships)).toEqual([]);
    expect(await t.appDb.select().from(sessions)).toEqual([]);
  });

  it('contexte e-mail : seul le compte de cet e-mail est visible', async () => {
    const rows = await withDbContext(t.appDb, { authEmail: userA.email }, (tx) =>
      tx.select().from(users),
    );
    expect(rows.map((r) => r.id)).toEqual([userA.id]);
  });

  it('contexte cabinet A : seuls les membres de A sont visibles', async () => {
    const ids = await withTenant(t.appDb, a.id, (tx) =>
      tx.select({ id: users.id }).from(users),
    ).then((r) => r.map((x) => x.id));
    expect(ids).toContain(userA.id);
    expect(ids).toContain(both.id);
    expect(ids).not.toContain(userB.id);
  });

  it('contexte cabinet A : les sessions de B sont invisibles', async () => {
    const rows = await withTenant(t.appDb, a.id, (tx) => tx.select().from(sessions));
    expect(rows.every((s) => s.clinicId === a.id)).toBe(true);
    expect(rows.some((s) => s.userId === userB.id)).toBe(false);
  });

  it('contexte jeton : seule la session de ce jeton est visible', async () => {
    const hash = hashToken(tokenA);
    const rows = await withDbContext(t.appDb, { sessionTokenHash: hash }, (tx) =>
      tx.select().from(sessions),
    );
    expect(rows.map((s) => s.userId)).toEqual([userA.id]);
  });

  it('contexte compte (connexion) : ses appartenances dans tous ses cabinets ; en contexte cabinet, seulement celle-ci', async () => {
    const own = await withDbContext(t.appDb, { userId: both.id }, (tx) =>
      tx.select().from(clinicMemberships),
    );
    expect(own.map((m) => m.clinicId).sort()).toEqual([a.id, b.id].sort());
    const scoped = await withDbContext(t.appDb, { userId: both.id, clinicId: a.id }, (tx) =>
      tx.select().from(clinicMemberships).where(eq(clinicMemberships.userId, both.id)),
    );
    expect(scoped.map((m) => m.clinicId)).toEqual([a.id]);
  });

  it.each([
    ['e-mail', sql`UPDATE users SET email = 'pirate@x.test'`],
    ['statut plateforme', sql`UPDATE users SET status = 'DISABLED'`],
    ['suppression de compte', sql`DELETE FROM users`],
    ['suppression d’appartenance', sql`DELETE FROM clinic_memberships`],
  ])('le rôle applicatif ne peut pas modifier : %s', async (_label, statement) => {
    await expect(withTenant(t.appDb, a.id, (tx) => tx.execute(statement))).rejects.toMatchObject({
      cause: { code: '42501' },
    });
  });

  // Seule exception (migration 0018) : les sessions terminées depuis plus de 30 jours, pour la
  // tâche de conservation ; une session active ou récente n'est jamais supprimée.
  it('suppression de session : aucune session active ou récente, même sans condition', async () => {
    const count = () =>
      withTenant(t.appDb, a.id, (tx) => tx.select().from(sessions)).then((r) => r.length);
    const before = await count();
    expect(before).toBeGreaterThan(0);
    const deleted = await withTenant(t.appDb, a.id, (tx) =>
      tx.execute(sql`DELETE FROM sessions RETURNING id`),
    );
    expect(deleted.rows).toEqual([]);
    expect(await count()).toBe(before);
  });
});
