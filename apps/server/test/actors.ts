import type { Role } from '@dental/shared';
import type { UserActor } from '../src/modules/auth/auth.types';

export function actorFor(userId: string, role: Role, clinicId: string): UserActor {
  return {
    kind: 'USER',
    userId,
    clinicId,
    role,
    sessionId: '00000000-0000-7000-8000-000000000000',
  };
}
