import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { META, createTestAuth, createUser, testClock, totpAt } from '../../../../test/auth';
import { createTestClinic, openTestDatabase } from '../../../../test/db';
import type { Clinic } from '../../../db/schema';
import { SECURITY_POLICY } from '../security-policy';

const P = SECURITY_POLICY;
const outcome = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: { code?: string }) => e.code ?? 'erreur',
  );

/**
 * Limitation des tentatives (docs/adr/0011) : le verrouillage doit tenir face à des tentatives
 * simultanées, et les codes TOTP faux comptent pour le compte, pas seulement pour la session.
 */
describe('authentification : tentatives simultanées et codes faux répétés', () => {
  const t = openTestDatabase({ appPoolMax: 20 });
  let clinic: Clinic;
  beforeAll(async () => {
    clinic = await createTestClinic(t.ownerDb);
  });
  afterAll(() => t.close());

  it(`des mots de passe faux envoyés en parallèle ne sont jamais évalués plus de ${P.loginMaxFailures} fois`, async () => {
    const { auth } = createTestAuth(t.appDb);
    const user = await createUser(t.ownerDb, clinic.id, 'SECRETARY');
    const burst = P.loginMaxFailures + 6;
    const results = await Promise.all(
      Array.from({ length: burst }, () =>
        outcome(auth.login({ email: user.email, password: 'mauvais-mot-de-passe' }, META)),
      ),
    );
    // Chaque INVALID_CREDENTIALS est un mot de passe réellement comparé ; les tentatives
    // simultanées sont refusées sans évaluation.
    let evaluated = results.filter((r) => r === 'INVALID_CREDENTIALS').length;
    expect(evaluated).toBeGreaterThan(0);
    expect(
      results.filter((r) => r !== 'INVALID_CREDENTIALS').every((r) => r === 'RATE_LIMITED'),
    ).toBe(true);
    // Le compteur n'a perdu aucun échec : le verrouillage tombe exactement au seuil.
    for (;;) {
      const r = await outcome(auth.login({ email: user.email, password: 'mauvais' }, META));
      if (r === 'ACCOUNT_LOCKED') break;
      expect(r).toBe('INVALID_CREDENTIALS');
      evaluated += 1;
    }
    expect(evaluated).toBe(P.loginMaxFailures);
    await expect(
      auth.login({ email: user.email, password: user.password }, META),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
  });

  it('adresse inconnue : même refus pour des tentatives simultanées (pas d’indice d’existence)', async () => {
    const { auth } = createTestAuth(t.appDb);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        outcome(auth.login({ email: 'personne@cabinet.test', password: 'x' }, META)),
      ),
    );
    expect(results).toContain('INVALID_CREDENTIALS');
    expect(results.every((r) => r === 'INVALID_CREDENTIALS' || r === 'RATE_LIMITED')).toBe(true);
    expect(results).toContain('RATE_LIMITED');
  });

  it('connaître le mot de passe ne permet pas d’essayer des codes TOTP sans limite', async () => {
    const clock = testClock();
    const { auth } = createTestAuth(t.appDb, clock);
    const user = await createUser(t.ownerDb, clinic.id, 'DENTIST');
    const enrolment = (await auth.resolveSession(
      (await auth.login({ email: user.email, password: user.password }, META)).token,
    ))!;
    const { secret } = await auth.setupMfa(enrolment);
    await auth.activateMfa(enrolment, await totpAt(secret, clock.epochSeconds()), META);
    clock.advanceSeconds(60);

    // Une session en attente de code, ouverte avant les échecs.
    const spare = (await auth.resolveSession(
      (await auth.login({ email: user.email, password: user.password }, META)).token,
    ))!;

    // Nouvelles sessions en boucle, codes faux : le compte finit verrouillé.
    let wrongCodes = 0;
    let locked = false;
    while (!locked && wrongCodes < 4 * P.loginMaxFailures) {
      const login = await auth
        .login({ email: user.email, password: user.password }, META)
        .catch((e: { code?: string }) => e.code ?? 'erreur');
      if (typeof login === 'string') {
        expect(login).toBe('ACCOUNT_LOCKED');
        locked = true;
        break;
      }
      const session = (await auth.resolveSession(login.token))!;
      for (let i = 0; i < P.mfaMaxAttempts; i++) {
        const r = await outcome(auth.verifyMfa(session, '000000', META));
        if (r === 'ACCOUNT_LOCKED') {
          locked = true;
          break;
        }
        wrongCodes += 1;
        if (r === 'UNAUTHENTICATED') break;
      }
    }
    expect(locked).toBe(true);
    expect(wrongCodes).toBeLessThanOrEqual(P.loginMaxFailures);
    // Pendant le verrouillage, même le bon code est refusé sur une session déjà ouverte.
    clock.advanceSeconds(30);
    await expect(
      auth.verifyMfa(spare, await totpAt(secret, clock.epochSeconds()), META),
    ).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    // Après le délai, la connexion complète redevient possible et remet le compteur à zéro.
    clock.advanceMinutes(P.loginLockMinutes);
    const pending = await auth.login({ email: user.email, password: user.password }, META);
    const session = (await auth.resolveSession(pending.token))!;
    await expect(
      auth.verifyMfa(session, await totpAt(secret, clock.epochSeconds()), META),
    ).resolves.toMatchObject({ restriction: null });
  });
});
