import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_LABELS,
  ROLE_LABELS,
  auditActionLabel,
  formatCents,
  type AuditAction,
  type AuditLogEntry,
} from '@dental/shared';
import { APPOINTMENT_STATUS_LABELS, OVERRIDE_REASON_LABELS } from '../agenda/labels';
import { PAYMENT_METHOD_LABELS } from '../finance/labels';
import { formatLocalDate, formatTime, localDateOf } from '../../lib/dates';

/** Groupes du filtre « action », dans l'ordre d'affichage. */
const GROUPS: [string, string][] = [
  ['auth', 'Connexions'],
  ['user', 'Comptes'],
  ['patient', 'Patients'],
  ['appointment', 'Rendez-vous'],
  ['charge', 'Encaissements'],
  ['payment', 'Encaissements'],
  ['practitioner', 'Cabinet et agenda'],
  ['appointment_type', 'Cabinet et agenda'],
  ['schedule', 'Cabinet et agenda'],
  ['availability_block', 'Cabinet et agenda'],
  ['clinic', 'Cabinet et agenda'],
  ['import', 'Imports'],
];

export function actionGroups(): { label: string; actions: AuditAction[] }[] {
  const groups = new Map<string, AuditAction[]>();
  for (const [prefix, label] of GROUPS) {
    const list = groups.get(label) ?? [];
    list.push(...AUDIT_ACTIONS.filter((a) => a.slice(0, a.indexOf('.')) === prefix));
    groups.set(label, list);
  }
  return [...groups].map(([label, actions]) => ({ label, actions }));
}

export { auditActionLabel };

export function entityTypeLabel(type: string | null): string {
  return type ? ((AUDIT_ENTITY_LABELS as Record<string, string>)[type] ?? type) : '';
}

/** Date et heure d'une entrée, dans le fuseau du cabinet. */
export function formatWhen(iso: string, timeZone: string): string {
  return `${formatLocalDate(localDateOf(iso, timeZone))} à ${formatTime(iso, timeZone)}`;
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Statut',
  role: 'Rôle',
  startAt: 'Début',
  endAt: 'Fin',
  amountCents: 'Montant',
  billingExempt: 'Sans facturation',
  practitionerId: 'Praticien',
  appointmentTypeId: 'Type de rendez-vous',
  appointmentId: 'Rendez-vous',
  patientId: 'Patient',
  chargeId: 'Acte',
  userId: 'Compte lié',
  note: 'Note',
  label: 'Libellé',
  reasons: 'Dérogation',
  cancellationReason: 'Motif',
  voidReason: 'Motif',
  method: 'Moyen de paiement',
  currency: 'Devise',
  name: 'Nom',
  displayName: 'Nom affiché',
  color: 'Couleur',
  durationMinutes: 'Durée (min)',
  lastName: 'Nom',
  firstName: 'Prénom',
  birthDate: 'Date de naissance',
  email: 'E-mail',
  administrativeNote: 'Note administrative',
  timezone: 'Fuseau horaire',
  kind: 'Nature',
  validFrom: 'À partir du',
};

const VALUE_LABELS: Record<string, string> = {
  ...APPOINTMENT_STATUS_LABELS,
  ...ROLE_LABELS,
  ...PAYMENT_METHOD_LABELS,
  ...OVERRIDE_REASON_LABELS,
  OPEN: 'Ouvert',
  RECORDED: 'Enregistré',
  VOIDED: 'Annulé',
  ACTIVE: 'Actif',
  DISABLED: 'Désactivé',
  ARCHIVED: 'Archivé',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function formatValue(
  field: string,
  value: string | number | boolean | null,
  context: { timeZone: string; currency: string },
): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number') {
    return field.endsWith('Cents') ? formatCents(value, context.currency) : String(value);
  }
  if (INSTANT.test(value)) return formatWhen(value, context.timeZone);
  return value
    .split(',')
    .map((v) => VALUE_LABELS[v] ?? v)
    .join(', ');
}

/**
 * Résumé des champs d'une entrée : « Statut : Prévu → Annulé · Motif ». Les identifiants ne
 * sont pas affichés (seulement « modifié ») ; aucun contenu saisi n'est dans le journal.
 */
export function describeChanges(
  changes: AuditLogEntry['changes'],
  context: { timeZone: string; currency: string },
): string[] {
  if (!changes) return [];
  return Object.entries(changes).map(([field, change]) => {
    const label = FIELD_LABELS[field] ?? field;
    const shown = (v: typeof change.from) =>
      v !== undefined && !(typeof v === 'string' && UUID.test(v));
    const from = shown(change.from) ? formatValue(field, change.from!, context) : null;
    const to = shown(change.to) ? formatValue(field, change.to!, context) : null;
    if (from !== null && to !== null) return `${label} : ${from} → ${to}`;
    if (to !== null) return `${label} : ${to}`;
    if (from !== null) return `${label} : ${from} (avant)`;
    return label;
  });
}

/** Auteur d'une entrée. */
export function actorLabel(entry: AuditLogEntry): string {
  if (entry.actor) return entry.actor.name;
  if (entry.actorType === 'SYSTEM') return 'Système';
  return 'Compte retiré du cabinet';
}
