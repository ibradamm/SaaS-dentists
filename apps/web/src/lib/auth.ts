import type { MeResponse, Permission, SessionRestriction } from '@dental/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const ME_QUERY_KEY = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: api.me, staleTime: 60_000, retry: false });
}

/** Masquage d'interface uniquement : le serveur vérifie chaque permission. */
export function can(me: MeResponse | null | undefined, permission: Permission): boolean {
  return me?.permissions.includes(permission) ?? false;
}

/** Page de l'étape d'authentification à terminer. */
export const RESTRICTION_PATHS: Record<SessionRestriction, string> = {
  MFA_PENDING: '/connexion/code',
  PASSWORD_CHANGE_REQUIRED: '/connexion/mot-de-passe',
  MFA_ENROLLMENT_REQUIRED: '/connexion/double-authentification',
};

export function pathAfterLogin(restriction: SessionRestriction | null): string {
  return restriction ? RESTRICTION_PATHS[restriction] : '/';
}
