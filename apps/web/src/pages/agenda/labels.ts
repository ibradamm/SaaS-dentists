import type { AppointmentStatus } from '@dental/shared';

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

export const STATUS_TONES: Record<AppointmentStatus, 'info' | 'success' | 'warning' | 'neutral'> = {
  SCHEDULED: 'info',
  COMPLETED: 'success',
  NO_SHOW: 'warning',
  CANCELLED: 'neutral',
};
