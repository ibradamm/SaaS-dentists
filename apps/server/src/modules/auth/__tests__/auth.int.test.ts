import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  META,
  createTestAuth,
  createUser,
  testClock,
  totpAt,
  uniqueEmail,
} from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import { auditLogs, clinicMemberships, clinics, users, type Clinic } from '../../../db/schema';
import { withTenant } from '../../../db/tenant';
import { SECURITY_POLICY } from '../security-policy';

describe('authentification (services, base réelle, rôle applicatif)', () => {
  const t = openTestDatabase();
  let clinic: Clinic;
  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
  });
  afterAll(() => t.close());

  const auditActions = (userId: string) =>
    withTenant(t.appDb, clinic.id, (tx) =>
      tx.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.actorId, userId)),
    ).then((rows) => rows.map((r) => r.action));

  describe('connexion par mot de passe', () => {
    it('réussit et ouvre une session résolvable, auditée', async () => {
      const { auth } = createTestAuth(t.appDb);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      const issued = await auth.login({ email: user.email, password: user.password }, META);
      expect(issued.restriction).toBeNull();
      const session = await auth.resolveSession(issued.token);
      expect(session?.actor).toMatchObject({
        userId: user.id,
        clinicId: clinic.id,
        role: 'SECRETARY',
      });
      expect(session?.csrfToken).toBe(issued.csrfToken);
      expect(await auditActions(user.id)).toContain('auth.login_succeeded');
    });

    it('refuse un mauvais mot de passe avec le même message qu’un compte inconnu', async () => {
      const { auth } = createTestAuth(t.appDb);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      const wrong = auth.login({ email: user.email, password: 'mauvais-mot-de-passe' }, META);
      await expect(wrong).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
      const unknown = auth.login({ email: uniqueEmail('inconnu'), password: 'x' }, META);
      await expect(unknown).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Adresse e-mail ou mot de passe incorrect',
      });
      expect(await auditActions(user.id)).toContain('auth.login_failed');
    });

    it(`verrouille le compte après ${SECURITY_POLICY.loginMaxFailures} échecs, puis le libère après le délai`, async () => {
      const clock = testClock();
      const { auth } = createTestAuth(t.appDb, clock);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      for (let i = 0; i < SECURITY_POLICY.loginMaxFailures; i++) {
        await expect(
          auth.login({ email: user.email, password: 'faux' }, META),
        ).rejects.toMatchObject({
          code: 'INVALID_CREDENTIALS',
        });
      }
      // Même le bon mot de passe est refusé pendant le verrouillage.
      await expect(
        auth.login({ email: user.email, password: user.password }, META),
      ).rejects.toMatchObject({
        code: 'ACCOUNT_LOCKED',
        statusCode: 423,
      });
      expect(await auditActions(user.id)).toContain('auth.account_locked');
      clock.advanceMinutes(SECURITY_POLICY.loginLockMinutes + 1);
      await expect(
        auth.login({ email: user.email, password: user.password }, META),
      ).resolves.toBeDefined();
    });

    it('un succès remet le compteur d’échecs à zéro', async () => {
      const { auth } = createTestAuth(t.appDb);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      for (let i = 0; i < SECURITY_POLICY.loginMaxFailures - 1; i++) {
        await auth.login({ email: user.email, password: 'faux' }, META).catch(() => undefined);
      }
      await auth.login({ email: user.email, password: user.password }, META);
      const [row] = await withTenant(t.appDb, clinic.id, (tx) =>
        tx.select({ n: users.failedLoginCount }).from(users).where(eq(users.id, user.id)),
      );
      expect(row?.n).toBe(0);
    });

    it('refuse un compte dont l’appartenance au cabinet est désactivée', async () => {
      const { auth } = createTestAuth(t.appDb);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      const issued = await auth.login({ email: user.email, password: user.password }, META);
      await withTenant(t.ownerDb, clinic.id, (tx) =>
        tx
          .update(clinicMemberships)
          .set({ status: 'DISABLED' })
          .where(
            and(eq(clinicMemberships.clinicId, clinic.id), eq(clinicMemberships.userId, user.id)),
          ),
      );
      expect(await auth.resolveSession(issued.token)).toBeNull();
      await expect(
        auth.login({ email: user.email, password: user.password }, META),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('compte de plusieurs cabinets : choix proposé après le mot de passe, session dans le cabinet choisi', async () => {
      const { auth } = createTestAuth(t.appDb);
      const first = await createTestClinic(t.ownerDb, { name: 'Cabinet des Tilleuls' });
      const second = await createTestClinic(t.ownerDb, { name: 'Cabinet Albert' });
      const outsider = await createTestClinic(t.ownerDb, { name: 'Cabinet étranger' });
      const suspended = await createTestClinic(t.ownerDb, { name: 'Cabinet Suspendu' });
      const user = await createUser(t.ownerDb, first.id, 'SECRETARY');
      for (const other of [second, suspended]) {
        await withTenant(t.ownerDb, other.id, (tx) =>
          tx.insert(clinicMemberships).values({ userId: user.id, role: 'SECRETARY' }),
        );
      }
      // Cabinet suspendu : jamais proposé.
      await withTenant(t.ownerDb, suspended.id, (tx) =>
        tx.update(clinics).set({ status: 'SUSPENDED' }).where(eq(clinics.id, suspended.id)),
      );
      const credentials = { email: user.email, password: user.password };
      await expect(auth.login(credentials, META)).rejects.toMatchObject({
        code: 'CLINIC_SELECTION_REQUIRED',
        statusCode: 409,
        clinics: [
          { id: second.id, name: 'Cabinet Albert' },
          { id: first.id, name: 'Cabinet des Tilleuls' },
        ],
      });
      // Mauvais mot de passe : aucun cabinet révélé.
      const wrong = await auth
        .login({ ...credentials, password: 'mauvais-mot-de-passe' }, META)
        .catch((e: { code: string; clinics?: unknown }) => e);
      expect(wrong).toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect((wrong as { clinics?: unknown }).clinics).toBeUndefined();
      // Cabinet choisi : la session y est ouverte ; un cabinet dont il n'est pas membre : refus.
      const issued = await auth.login({ ...credentials, clinicId: second.id }, META);
      expect((await auth.resolveSession(issued.token))?.actor.clinicId).toBe(second.id);
      await expect(
        auth.login({ ...credentials, clinicId: outsider.id }, META),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });
  });

  describe('sessions', () => {
    it("expire après la durée d'inactivité", async () => {
      const clock = testClock();
      const { auth } = createTestAuth(t.appDb, clock);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      const issued = await auth.login({ email: user.email, password: user.password }, META);
      clock.advanceMinutes(SECURITY_POLICY.sessionIdleMinutes - 1);
      expect(await auth.resolveSession(issued.token)).not.toBeNull();
      clock.advanceMinutes(SECURITY_POLICY.sessionIdleMinutes + 1);
      expect(await auth.resolveSession(issued.token)).toBeNull();
      // Une session expirée est révoquée : elle ne revit pas.
      clock.advanceMinutes(-SECURITY_POLICY.sessionIdleMinutes * 3);
      expect(await auth.resolveSession(issued.token)).toBeNull();
    });

    it("expire à la durée absolue même en cas d'activité continue", async () => {
      const clock = testClock();
      const { auth } = createTestAuth(t.appDb, clock);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      const issued = await auth.login({ email: user.email, password: user.password }, META);
      const steps = Math.ceil((SECURITY_POLICY.sessionAbsoluteHours * 60) / 30);
      let last: unknown = 'initial';
      for (let i = 0; i < steps; i++) {
        clock.advanceMinutes(30);
        last = await auth.resolveSession(issued.token);
      }
      expect(last).toBeNull();
    });

    it('la déconnexion invalide la session', async () => {
      const { auth } = createTestAuth(t.appDb);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
      const issued = await auth.login({ email: user.email, password: user.password }, META);
      const session = await auth.resolveSession(issued.token);
      await auth.logout(session!, META);
      expect(await auth.resolveSession(issued.token)).toBeNull();
    });

    it('un jeton inconnu ou mal formé ne résout aucune session', async () => {
      const { auth } = createTestAuth(t.appDb);
      expect(await auth.resolveSession('A'.repeat(43))).toBeNull();
      expect(await auth.resolveSession("' OR 1=1 --")).toBeNull();
      expect(await auth.resolveSession('')).toBeNull();
    });
  });

  describe('double authentification (TOTP)', () => {
    async function enrolledDentist() {
      const clock = testClock();
      const { auth } = createTestAuth(t.appDb, clock);
      const user = await createUser(t.ownerDb, clinic.id, 'DENTIST');
      const first = await auth.login({ email: user.email, password: user.password }, META);
      expect(first.restriction).toBe('MFA_ENROLLMENT_REQUIRED');
      const session = (await auth.resolveSession(first.token))!;
      const { secret, otpauthUri } = await auth.setupMfa(session);
      expect(otpauthUri).toContain('otpauth://totp/');
      const activated = await auth.activateMfa(
        session,
        await totpAt(secret, clock.epochSeconds()),
        META,
      );
      expect(activated.restriction).toBeNull();
      // Le jeton a été renouvelé : l'ancien ne vaut plus rien.
      expect(await auth.resolveSession(first.token)).toBeNull();
      return { auth, clock, user, secret };
    }

    it('un dentiste sans double authentification est restreint à sa mise en place', async () => {
      await enrolledDentist();
    });

    it('après activation, la connexion exige le code puis donne un accès complet', async () => {
      const { auth, clock, user, secret } = await enrolledDentist();
      clock.advanceSeconds(60);
      const pending = await auth.login({ email: user.email, password: user.password }, META);
      expect(pending.restriction).toBe('MFA_PENDING');
      const session = (await auth.resolveSession(pending.token))!;
      await expect(auth.verifyMfa(session, '000000', META)).rejects.toMatchObject({
        code: 'INVALID_MFA_CODE',
      });
      const done = await auth.verifyMfa(session, await totpAt(secret, clock.epochSeconds()), META);
      expect(done.restriction).toBeNull();
      expect(await auth.resolveSession(pending.token)).toBeNull();
      expect((await auth.resolveSession(done.token))?.state).toBe('ACTIVE');
    });

    it('un code déjà utilisé est refusé (rejeu)', async () => {
      const { auth, clock, user, secret } = await enrolledDentist();
      clock.advanceSeconds(60);
      const code = await totpAt(secret, clock.epochSeconds());
      const s1 = (await auth.resolveSession(
        (await auth.login({ email: user.email, password: user.password }, META)).token,
      ))!;
      await auth.verifyMfa(s1, code, META);
      const s2 = (await auth.resolveSession(
        (await auth.login({ email: user.email, password: user.password }, META)).token,
      ))!;
      await expect(auth.verifyMfa(s2, code, META)).rejects.toMatchObject({
        code: 'INVALID_MFA_CODE',
      });
      clock.advanceSeconds(30);
      await expect(
        auth.verifyMfa(s2, await totpAt(secret, clock.epochSeconds()), META),
      ).resolves.toBeDefined();
    });

    it(`révoque la session après ${SECURITY_POLICY.mfaMaxAttempts} codes faux`, async () => {
      const { auth, clock, user } = await enrolledDentist();
      clock.advanceSeconds(60);
      const pending = await auth.login({ email: user.email, password: user.password }, META);
      const session = (await auth.resolveSession(pending.token))!;
      for (let i = 0; i < SECURITY_POLICY.mfaMaxAttempts - 1; i++) {
        await expect(auth.verifyMfa(session, '000000', META)).rejects.toMatchObject({
          code: 'INVALID_MFA_CODE',
        });
      }
      await expect(auth.verifyMfa(session, '000000', META)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      expect(await auth.resolveSession(pending.token)).toBeNull();
    });

    it('une étape de code non terminée expire', async () => {
      const { auth, clock, user } = await enrolledDentist();
      clock.advanceSeconds(60);
      const pending = await auth.login({ email: user.email, password: user.password }, META);
      clock.advanceMinutes(SECURITY_POLICY.mfaPendingMinutes + 1);
      expect(await auth.resolveSession(pending.token)).toBeNull();
    });

    it('le secret TOTP est stocké chiffré', async () => {
      const { user, secret } = await enrolledDentist();
      const [row] = await withTenant(t.appDb, clinic.id, (tx) =>
        tx.select({ enc: users.mfaSecretEnc }).from(users).where(eq(users.id, user.id)),
      );
      expect(row?.enc).toMatch(/^v1\./);
      expect(row?.enc).not.toContain(secret);
    });
  });

  describe('changement de mot de passe', () => {
    it('le mot de passe temporaire impose un changement, qui ferme les autres sessions', async () => {
      const { auth } = createTestAuth(t.appDb);
      const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY', {
        mustChangePassword: true,
      });
      const other = await auth.login({ email: user.email, password: user.password }, META);
      const issued = await auth.login({ email: user.email, password: user.password }, META);
      expect(issued.restriction).toBe('PASSWORD_CHANGE_REQUIRED');
      const session = (await auth.resolveSession(issued.token))!;
      await expect(
        auth.changePassword(
          session,
          { currentPassword: 'faux', newPassword: 'nouveau-mot-de-passe-solide' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(
        auth.changePassword(
          session,
          { currentPassword: user.password, newPassword: 'court' },
          META,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        auth.changePassword(
          session,
          { currentPassword: user.password, newPassword: user.email },
          META,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      const changed = await auth.changePassword(
        session,
        { currentPassword: user.password, newPassword: 'nouveau-mot-de-passe-solide' },
        META,
      );
      expect(changed.restriction).toBeNull();
      expect(await auth.resolveSession(other.token)).toBeNull();
      expect(await auth.resolveSession(issued.token)).toBeNull();
      expect(await auth.resolveSession(changed.token)).not.toBeNull();
      await expect(
        auth.login({ email: user.email, password: user.password }, META),
      ).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      await expect(
        auth.login({ email: user.email, password: 'nouveau-mot-de-passe-solide' }, META),
      ).resolves.toMatchObject({ restriction: null });
    });
  });
});
