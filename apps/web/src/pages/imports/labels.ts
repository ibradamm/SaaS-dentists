import type { ImportIssue, ImportSummary } from '@dental/shared';
import { FIELD_LABELS } from '../../lib/import/mapping';

export const BATCH_STATUS_LABELS: Record<ImportSummary['status'], string> = {
  DRAFT: 'En cours de vérification',
  COMMITTED: 'Importé',
  REVERTED: 'Annulé',
  DISCARDED: 'Abandonné',
};

export const ROW_STATUS_LABELS = {
  VALID: 'Importable',
  INVALID: 'Refusée',
  DUPLICATE_IN_FILE: 'Doublon dans le fichier',
  EXISTING: 'Déjà enregistré',
} as const;

const ISSUE_LABELS: Record<ImportIssue['code'], string> = {
  REQUIRED: 'obligatoire mais vide',
  TOO_LONG: 'trop long',
  INVALID_DATE: 'date illisible',
  DATE_OUT_OF_RANGE: 'date hors limites (avant 1900 ou future)',
  INVALID_PHONE: 'numéro invalide',
  INVALID_EMAIL: 'adresse e-mail invalide',
  DUPLICATE_IN_FILE: 'patient déjà présent plus haut dans le fichier',
  EXISTING_PATIENT: 'patient déjà enregistré dans le logiciel',
  POSSIBLE_DUPLICATE: 'homonyme déjà enregistré sans date de naissance : à vérifier après import',
  DUPLICATE_LINE: 'ligne reçue deux fois',
};

/** Texte d'une anomalie : champ concerné, problème, conséquence (valeur ignorée ou ligne refusée). */
export function issueText(issue: ImportIssue): string {
  const field = issue.field
    ? `${FIELD_LABELS[issue.field as keyof typeof FIELD_LABELS] ?? issue.field} : `
    : '';
  const consequence = issue.severity === 'warning' && issue.field ? ' (valeur ignorée)' : '';
  return `${field}${ISSUE_LABELS[issue.code]}${consequence}`;
}
