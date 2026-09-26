import { generate, generateSecret } from 'otplib';
import { describe, expect, it } from 'vitest';
import { verifyTotp } from '../totp';

describe('vérification TOTP', () => {
  const secret = generateSecret();
  const epoch = 1_790_000_010; // milieu d'un pas de 30 s
  const step = Math.floor(epoch / 30);

  it('accepte le code du pas courant et renvoie ce pas', async () => {
    const code = await generate({ secret, epoch });
    expect(await verifyTotp({ secret, code, afterTimeStep: null, epochSeconds: epoch })).toEqual({
      valid: true,
      timeStep: step,
    });
  });

  it('refuse un code dont le pas a déjà été utilisé (anti-rejeu)', async () => {
    const code = await generate({ secret, epoch });
    const check = await verifyTotp({ secret, code, afterTimeStep: step, epochSeconds: epoch });
    expect(check.valid).toBe(false);
  });

  it('accepte le pas suivant le dernier utilisé', async () => {
    const code = await generate({ secret, epoch });
    const check = await verifyTotp({ secret, code, afterTimeStep: step - 1, epochSeconds: epoch });
    expect(check.valid).toBe(true);
  });

  it("tolère un décalage d'horloge d'un pas, pas davantage", async () => {
    const previous = await generate({ secret, epoch: epoch - 30 });
    const tooOld = await generate({ secret, epoch: epoch - 90 });
    expect(
      (await verifyTotp({ secret, code: previous, afterTimeStep: null, epochSeconds: epoch }))
        .valid,
    ).toBe(true);
    expect(
      (await verifyTotp({ secret, code: tooOld, afterTimeStep: null, epochSeconds: epoch })).valid,
    ).toBe(false);
  });

  it('refuse un code faux ou mal formé', async () => {
    for (const code of ['000000', '12345', 'abcdef', '']) {
      const check = await verifyTotp({
        secret,
        code,
        afterTimeStep: null,
        epochSeconds: epoch,
      }).catch(() => ({ valid: false }));
      expect(check.valid).toBe(false);
    }
  });
});
