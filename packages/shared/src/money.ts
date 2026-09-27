import { z } from 'zod';

/*
 * Montants en centimes entiers, du navigateur à la base (docs/adr/0009, F1). Saisie et affichage
 * passent par des chaînes de caractères : aucun calcul en nombres à virgule.
 */

/** Plafond d'un montant dû ou d'un paiement : 1 000 000,00. */
export const MAX_AMOUNT_CENTS = 100_000_000;

export const amountCentsSchema = z
  .number()
  .int('Montant en centimes entiers')
  .positive('Le montant doit être supérieur à zéro')
  .max(MAX_AMOUNT_CENTS, 'Montant trop élevé');

export const currencySchema = z.string().regex(/^[A-Z]{3}$/);

// Espaces ordinaires, insécables et fines insécables (séparateurs de milliers en français).
const SPACES = /[\s\u00a0\u202f]/g;

/**
 * Saisie d'un montant (« 45 », « 45,5 », « 45,50 », « 1 234,56 », « 1234.56 ») en centimes.
 * Au plus deux décimales ; signe, lettres et séparateurs multiples refusés. Renvoie null si la
 * saisie n'est pas un montant ; zéro est renvoyé tel quel (le schéma le refuse ensuite).
 */
export function parseAmountToCents(input: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(input.replace(SPACES, '').replace(/€$/, ''));
  if (!match) return null;
  const units = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  return units * 100 + fraction;
}

/** Représentation décimale exacte (« 1234.56 ») d'un nombre entier de centimes. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('Montant invalide');
  const abs = Math.abs(cents);
  const fraction = abs % 100;
  const units = (abs - fraction) / 100;
  return `${cents < 0 ? '-' : ''}${units}.${String(fraction).padStart(2, '0')}`;
}

/** Valeur de champ de saisie (« 45,50 ») pour un nombre de centimes. */
export function centsToInput(cents: number): string {
  return centsToDecimalString(cents).replace('.', ',');
}

/** « 1 234,56 € » : mise en forme exacte (Intl reçoit une chaîne décimale, pas un flottant). */
export function formatCents(cents: number, currency: string, locale = 'fr-FR'): string {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
  return format.format(centsToDecimalString(cents) as unknown as number);
}
