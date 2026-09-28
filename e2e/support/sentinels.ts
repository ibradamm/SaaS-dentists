/**
 * Données saisies par les tests, reconnaissables : aucune ne doit apparaître dans les journaux
 * de l'API ou du worker (vérifié à la fin de l'exécution, support/global-teardown.ts).
 */
export const PATIENTS = {
  a: ['Aubertin', 'Léonie'],
  b: ['Brissac', 'Hugo'],
  c: ['Castagnet', 'Chloé'],
  d: ['Delpierre', 'Maël'],
  e: ['Esquirol', 'Inès'],
  f: ['Fabregas', 'Noé'],
  g: ['Guillemot', 'Rose'],
} as const;
export const MEDICAL_NOTE = 'Allergie à la pénicilline (note e2e)';
export const ADMIN_NOTE = 'Préfère les rendez-vous du matin (note e2e)';
export const PHONE_DIGITS = '612345678';

/** Motifs et libellés libres saisis par les tests : jamais recopiés dans l'audit ni les tâches. */
export const TYPED_REASONS = [
  'À la demande du patient',
  'Erreur de moyen de paiement',
  'Acte non réalisé',
  'Radio panoramique',
];

export const FORBIDDEN_IN_LOGS = [
  ...Object.values(PATIENTS).flat(),
  MEDICAL_NOTE,
  ADMIN_NOTE,
  'phrase secrète de test e2e',
  PHONE_DIGITS,
];
