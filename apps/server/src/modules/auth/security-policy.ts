/**
 * Paramètres de sécurité de l'authentification. Centralisés ici pour être relus et testés
 * ensemble ; toute modification passe par une revue.
 */
export const SECURITY_POLICY = {
  // Verrouillage du compte après échecs consécutifs (le compteur repart à zéro au verrouillage).
  loginMaxFailures: 10,
  loginLockMinutes: 15,
  // Sessions : inactivité et durée absolue.
  sessionIdleMinutes: 60,
  sessionAbsoluteHours: 12,
  // Étape de double authentification après le mot de passe.
  mfaPendingMinutes: 5,
  mfaMaxAttempts: 5,
  // Tolérance de décalage d'horloge pour le code TOTP (±1 pas de 30 s).
  totpToleranceSeconds: 30,
  // Sessions terminées conservées 30 jours par défaut (enquête de sécurité), puis supprimées
  // par la tâche de conservation. Durée configurable (SESSION_RETENTION_DAYS) mais jamais en
  // dessous de ce plancher, inscrit dans la politique RLS (migration 0018) : le raccourcir
  // demande une nouvelle migration (docs/adr/0011, section 6).
  sessionRetentionDays: 30,
  // Mise à jour de last_seen_at au plus une fois par minute (évite une écriture par requête).
  sessionTouchSeconds: 60,
  // Paramètres Argon2id (recommandation OWASP : m=19 Mio, t=2, p=1).
  argon2: { memoryCost: 19_456, timeCost: 2, parallelism: 1 },
} as const;
