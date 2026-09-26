import { roleHasPermission, type Permission } from '@dental/shared';
import { AppError } from '../../lib/errors';
import type { UserActor } from './auth.types';

/**
 * Contrôle d'autorisation unique, appelé par chaque service métier (API, outils de l'agent,
 * tâches) : l'interface masque les actions non permises, le serveur les refuse.
 */
export function authorize(actor: UserActor, permission: Permission): void {
  if (!roleHasPermission(actor.role, permission)) {
    throw new AppError('FORBIDDEN', "Vous n'avez pas les droits pour cette action", 403);
  }
}
