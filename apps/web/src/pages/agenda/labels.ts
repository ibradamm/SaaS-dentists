import type { AppointmentStatus, OverrideReason } from '@dental/shared';

/** Libellés des statuts. Un nouveau statut ajouté au modèle doit recevoir le sien ici. */
export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Prévu',
  COMPLETED: 'Honoré',
  NO_SHOW: 'Patient absent',
  CANCELLED: 'Annulé',
};

/** Libellé du bouton qui mène à ce statut. */
export const STATUS_ACTION_LABELS: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Remettre à « Prévu »',
  COMPLETED: 'Marquer honoré',
  NO_SHOW: 'Marquer patient absent',
  CANCELLED: 'Annuler le rendez-vous',
};

/** Raisons d'une confirmation exigée, affichées telles quelles avant de confirmer. */
export const OVERRIDE_REASON_LABELS: Record<OverrideReason, string> = {
  IN_PAST: 'Rendez-vous dans le passé',
  OUTSIDE_WORKING_HOURS: 'Hors des horaires du praticien',
  ON_BLOCK: 'Sur un créneau bloqué',
};

export const STATUS_TONES: Record<AppointmentStatus, 'info' | 'success' | 'warning' | 'neutral'> = {
  SCHEDULED: 'info',
  COMPLETED: 'success',
  NO_SHOW: 'warning',
  CANCELLED: 'neutral',
};
