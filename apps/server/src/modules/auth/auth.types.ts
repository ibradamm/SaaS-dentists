import type { Role, SessionRestriction } from '@dental/shared';

/** Contexte technique d'une requête, tracé dans l'audit. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/** Utilisateur authentifié agissant dans un cabinet. */
export interface UserActor {
  kind: 'USER';
  userId: string;
  clinicId: string;
  role: Role;
  sessionId: string;
}

export interface AuthenticatedSession {
  sessionId: string;
  state: 'MFA_PENDING' | 'ACTIVE';
  csrfToken: string;
  restriction: SessionRestriction | null;
  actor: UserActor;
  user: { id: string; email: string; fullName: string; mfaEnabled: boolean };
  clinic: { id: string; name: string };
}

/** Jeton de session émis (à placer dans le cookie) et jeton CSRF associé. */
export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  restriction: SessionRestriction | null;
}
