import { roleHasPermission, type Permission } from '@dental/shared';
import { AppError } from '../../lib/errors';
import type { UserActor } from './auth.types';

/**
 * Contrôle d'autorisation unique, appelé par chaque service métier (API, tâches de fond,
 * futurs points d'entrée) : l'interface masque les actions non permises, le serveur les refuse.
 */
export function authorize(actor: UserActor, permission: Permission): void {
  if (!roleHasPermission(actor.role, permission)) {
    throw new AppError('FORBIDDEN', "Vous n'avez pas les droits pour cette action", 403);
  }
}

/** Au moins une des permissions (ex. gérer son propre agenda ou celui de tout praticien). */
export function authorizeAny(actor: UserActor, permissions: readonly Permission[]): void {
  if (!permissions.some((p) => roleHasPermission(actor.role, p))) {
    throw new AppError('FORBIDDEN', "Vous n'avez pas les droits pour cette action", 403);
  }
}
