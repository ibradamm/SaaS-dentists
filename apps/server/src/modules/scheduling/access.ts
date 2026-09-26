import { roleHasPermission, type Permission } from '@dental/shared';
import { AppError } from '../../lib/errors';
import type { UserActor } from '../auth/auth.types';
import { authorizeAny } from '../auth/authorize';

export const SCHEDULE_PERMISSIONS: readonly Permission[] = [
  'schedule.manage_own',
  'schedule.manage_any',
];

/**
 * Peut-on gérer les horaires et indisponibilités de ce praticien ? `schedule.manage_any` :
 * tout praticien et tout le cabinet ; `schedule.manage_own` : seulement le praticien lié au
 * compte connecté. `practitioner` null : indisponibilité de tout le cabinet.
 */
export function canManageSchedule(
  actor: UserActor,
  practitioner: { userId: string | null } | null,
): boolean {
  if (roleHasPermission(actor.role, 'schedule.manage_any')) return true;
  return (
    practitioner !== null &&
    practitioner.userId === actor.userId &&
    roleHasPermission(actor.role, 'schedule.manage_own')
  );
}

export function authorizeSchedule(
  actor: UserActor,
  practitioner: { userId: string | null } | null,
): void {
  authorizeAny(actor, SCHEDULE_PERMISSIONS);
  if (!canManageSchedule(actor, practitioner)) {
    throw new AppError(
      'FORBIDDEN',
      practitioner === null
        ? "Seuls l'administrateur et le secrétariat gèrent les indisponibilités de tout le cabinet"
        : 'Vous ne pouvez gérer que votre propre agenda',
      403,
    );
  }
}
