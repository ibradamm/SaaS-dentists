import { and, eq, sql } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { sessions } from '../../db/schema';
import { SECURITY_POLICY as P } from './security-policy';

/**
 * Sessions du cabinet terminées (révoquées, expirées ou inactives) depuis plus de
 * `retentionDays` jours (SESSION_RETENTION_DAYS, 30 par défaut) : supprimées (adresse IP et
 * navigateur sont des données personnelles). La politique RLS sessions_delete_ended
 * (migration 0018) garantit en plus, avec l'horloge de la base, qu'aucune session terminée
 * depuis moins de SECURITY_POLICY.sessionRetentionDays jours n'est supprimable.
 */
export async function purgeEndedSessions(
  tx: Transaction,
  clinicId: string,
  now: Date,
  retentionDays: number = P.sessionRetentionDays,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const ended = sql`coalesce(${sessions.revokedAt}, least(${sessions.expiresAt}, ${sessions.lastSeenAt} + make_interval(mins => ${P.sessionIdleMinutes})))`;
  const deleted = await tx
    .delete(sessions)
    .where(and(eq(sessions.clinicId, clinicId), sql`${ended} < ${cutoff}::timestamptz`))
    .returning({ id: sessions.id });
  return deleted.length;
}
