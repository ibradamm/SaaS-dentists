import { MFA_REQUIRED_ROLES, type Role, type SessionRestriction } from '@dental/shared';

/**
 * Étape restante avant un accès complet, par ordre de priorité : code TOTP, changement du
 * mot de passe temporaire, mise en place de la double authentification si le rôle l'exige.
 */
export function computeRestriction(
  state: 'MFA_PENDING' | 'ACTIVE',
  user: { mustChangePassword: boolean; mfaEnabledAt: Date | null },
  role: Role,
): SessionRestriction | null {
  if (state === 'MFA_PENDING') return 'MFA_PENDING';
  if (user.mustChangePassword) return 'PASSWORD_CHANGE_REQUIRED';
  if (MFA_REQUIRED_ROLES.has(role) && user.mfaEnabledAt === null) return 'MFA_ENROLLMENT_REQUIRED';
  return null;
}
