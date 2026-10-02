import type { ChargeStatus, PaymentMethod, PaymentState } from '@dental/shared';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  CARD: 'Carte bancaire',
  CHECK: 'Chèque',
  TRANSFER: 'Virement',
  OTHER: 'Autre',
};

/** État d'un acte ouvert ; un acte annulé affiche « Annulé ». */
export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  UNPAID: 'À payer',
  PARTIALLY_PAID: 'Partiellement payé',
  PAID: 'Payé',
};

export const PAYMENT_STATE_TONES: Record<PaymentState, 'warning' | 'info' | 'success'> = {
  UNPAID: 'warning',
  PARTIALLY_PAID: 'info',
  PAID: 'success',
};

export const chargeStateLabel = (status: ChargeStatus, state: PaymentState) =>
  status === 'CANCELLED' ? 'Annulé' : PAYMENT_STATE_LABELS[state];
