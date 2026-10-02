import type { MeResponse, Permission, SessionRestriction } from '@dental/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const ME_QUERY_KEY = ['me'] as const;

export function useMe() {
  return useQuery({ queryKey: ME_QUERY_KEY, queryFn: api.me, staleTime: 60_000, retry: false });
}

/** Permissions dont dépend au moins une section du tableau de bord (docs/adr/0010). */
export const STATS_PERMISSIONS: readonly Permission[] = [
  'appointment.read',
  'patient.read',
  'payment.read',
  'finance.reports.read',
];

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

/**
 * Peut-on modifier l'agenda de ce praticien ? Même règle que le serveur (qui décide) :
 * tout agenda avec schedule.manage_any, sinon seulement le praticien lié à son compte.
 */
export function canManageSchedule(
  me: MeResponse | null | undefined,
  practitioner: { userId: string | null } | null,
): boolean {
  if (can(me, 'schedule.manage_any')) return true;
  return (
    practitioner !== null && practitioner.userId === me?.user.id && can(me, 'schedule.manage_own')
  );
}
