import { describe, expect, it } from 'vitest';
import {
  cancelChargeRequestSchema,
  createChargeRequestSchema,
  paymentStateOf,
  recordPaymentRequestSchema,
  revenueQuerySchema,
} from './finance';

const KEY = '01a0de00-0000-7000-8000-00000000abcd';
const PATIENT = '01a0de00-0000-7000-8000-00000000a001';

describe('contrats des paiements', () => {
  it('état de paiement calculé : à payer, partiellement payé, payé', () => {
    expect(paymentStateOf(6000, 0)).toBe('UNPAID');
    expect(paymentStateOf(6000, 1)).toBe('PARTIALLY_PAID');
    expect(paymentStateOf(6000, 5999)).toBe('PARTIALLY_PAID');
    expect(paymentStateOf(6000, 6000)).toBe('PAID');
  });

  it('montant dû : clé d’idempotence, libellé et montant entier obligatoires ; encaissement facultatif', () => {
    const base = {
      idempotencyKey: KEY,
      patientId: PATIENT,
      label: 'Détartrage',
      amountCents: 6000,
    };
    expect(createChargeRequestSchema.parse(base)).toEqual({
      ...base,
      appointmentId: null,
      practitionerId: null,
      payment: null,
    });
    expect(
      createChargeRequestSchema.parse({ ...base, payment: { amountCents: 2000, method: 'CARD' } })
        .payment,
    ).toEqual({ amountCents: 2000, method: 'CARD', reference: null });
    for (const bad of [
      { ...base, idempotencyKey: undefined },
      { ...base, idempotencyKey: 'pas-un-uuid' },
      { ...base, label: '  ' },
      { ...base, amountCents: 60.5 },
      { ...base, amountCents: 0 },
      { ...base, amountCents: '6000' },
      { ...base, payment: { amountCents: 2000, method: 'BITCOIN' } },
    ]) {
      expect(createChargeRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('paiement : montant positif entier ; annulation : motif obligatoire', () => {
    const payment = { idempotencyKey: KEY, chargeId: PATIENT, amountCents: 1500, method: 'CASH' };
    expect(recordPaymentRequestSchema.parse(payment).reference).toBeNull();
    expect(recordPaymentRequestSchema.safeParse({ ...payment, amountCents: -1500 }).success).toBe(
      false,
    );
    expect(cancelChargeRequestSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(cancelChargeRequestSchema.safeParse({ reason: 'Erreur de saisie' }).success).toBe(true);
    expect(revenueQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success).toBe(
      true,
    );
  });
});
