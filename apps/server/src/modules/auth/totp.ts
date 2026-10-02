import { generateSecret, generateURI, verify } from 'otplib';
import { SECURITY_POLICY } from './security-policy';

/** TOTP standard (RFC 6238 : SHA-1, 6 chiffres, 30 s), compatible avec les applications usuelles. */
export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpauthUri(options: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  return generateURI({ issuer: options.issuer, label: options.account, secret: options.secret });
}

export interface TotpCheck {
  valid: boolean;
  timeStep?: number;
}

/**
 * Vérifie un code. `afterTimeStep` : dernier pas accepté pour ce compte ; un code du même pas
 * ou d'un pas antérieur est refusé (protection contre le rejeu).
 */
export async function verifyTotp(options: {
  secret: string;
  code: string;
  afterTimeStep: number | null;
  epochSeconds?: number;
}): Promise<TotpCheck> {
  const result = await verify({
    secret: options.secret,
    token: options.code,
    epochTolerance: SECURITY_POLICY.totpToleranceSeconds,
    ...(options.afterTimeStep !== null ? { afterTimeStep: options.afterTimeStep } : {}),
    ...(options.epochSeconds !== undefined ? { epoch: options.epochSeconds } : {}),
  });
  // La fonction générique d'otplib type le résultat pour HOTP et TOTP ; seul TOTP renvoie
  // timeStep, indispensable à la protection contre le rejeu : son absence est un refus.
  if (result.valid && 'timeStep' in result && typeof result.timeStep === 'number') {
    return { valid: true, timeStep: result.timeStep };
  }
  return { valid: false };
}
