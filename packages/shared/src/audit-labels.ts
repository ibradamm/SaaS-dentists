import type { AuditAction, AuditEntityType } from './audit';

/*
 * Libellés du journal d'audit, séparés du catalogue (audit.ts) : le catalogue sert au client
 * API chargé au démarrage, les libellés seulement à la page « Journal ». Le typage impose un
 * libellé pour chaque action et chaque type d'élément.
 */

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'auth.login_succeeded': 'Connexion',
  'auth.login_failed': 'Connexion refusée (mot de passe)',
  'auth.mfa_failed': 'Connexion refusée (code de double authentification)',
  'auth.account_locked': 'Compte verrouillé après des échecs répétés',
  'auth.logout': 'Déconnexion',
  'auth.password_changed': 'Mot de passe changé',
  'auth.mfa_enabled': 'Double authentification activée',
  'user.created': 'Compte créé',
  'user.access_updated': "Rôle ou état d'un compte modifié",
  'user.password_reset': 'Mot de passe réinitialisé',
  'user.mfa_reset': 'Double authentification réinitialisée',
  'clinic.settings_update': 'Paramètres du cabinet modifiés',
  'patient.created': 'Fiche patient créée',
  'patient.updated': 'Fiche patient modifiée',
  'patient.archived': 'Fiche patient archivée',
  'patient.restored': 'Fiche patient réactivée',
  'patient.contact_added': 'Contact ajouté',
  'patient.contact_updated': 'Contact modifié',
  'patient.contact_removed': 'Contact supprimé',
  'patient.medical_notes_read': 'Notes médicales consultées',
  'patient.medical_note_added': 'Note médicale ajoutée',
  'import.created': 'Import préparé',
  'import.committed': 'Import validé',
  'import.discarded': 'Import abandonné',
  'import.reverted': 'Import annulé',
  'practitioner.created': 'Praticien ajouté',
  'practitioner.updated': 'Praticien modifié',
  'practitioner.archived': 'Praticien archivé',
  'practitioner.restored': 'Praticien réactivé',
  'appointment_type.created': 'Type de rendez-vous ajouté',
  'appointment_type.updated': 'Type de rendez-vous modifié',
  'appointment_type.archived': 'Type de rendez-vous archivé',
  'appointment_type.restored': 'Type de rendez-vous réactivé',
  'schedule.updated': 'Horaires modifiés',
  'schedule.period_deleted': "Période d'horaires supprimée",
  'availability_block.created': 'Indisponibilité ajoutée',
  'availability_block.updated': 'Indisponibilité modifiée',
  'availability_block.deleted': 'Indisponibilité supprimée',
  'appointment.created': 'Rendez-vous créé',
  'appointment.updated': 'Rendez-vous modifié',
  'appointment.status_changed': 'Statut de rendez-vous modifié',
  'appointment.availability_override': 'Rendez-vous hors horaires ou sur une indisponibilité',
  'appointment.billing_exempt': 'Mention « sans facturation » modifiée',
  'charge.created': 'Acte saisi',
  'charge.cancelled': 'Acte annulé',
  'payment.recorded': 'Paiement encaissé',
  'payment.voided': 'Paiement annulé',
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
  patient: 'Patient',
  appointment: 'Rendez-vous',
  charge: 'Acte',
  payment: 'Paiement',
  practitioner: 'Praticien',
  appointment_type: 'Type de rendez-vous',
  availability_block: 'Indisponibilité',
  import_batch: 'Import',
  user: 'Compte',
  clinic: 'Cabinet',
};

/** Libellé d'une action, y compris d'une action retirée du catalogue depuis son écriture. */
export function auditActionLabel(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action;
}
