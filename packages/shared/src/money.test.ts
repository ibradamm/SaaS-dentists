import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_CENTS,
  amountCentsSchema,
  centsToDecimalString,
  centsToInput,
  formatCents,
  parseAmountToCents,
} from './money';

describe('montants en centimes', () => {
  it('saisie : virgule ou point, espaces de milliers, au plus deux décimales', () => {
    expect(parseAmountToCents('45')).toBe(4500);
    expect(parseAmountToCents('45,5')).toBe(4550);
    expect(parseAmountToCents('45,50')).toBe(4550);
    expect(parseAmountToCents('45.05')).toBe(4505);
    expect(parseAmountToCents('1 234,56')).toBe(123456);
    expect(parseAmountToCents('1 234,56 €')).toBe(123456);
    expect(parseAmountToCents('0,01')).toBe(1);
    expect(parseAmountToCents('0')).toBe(0);
    // Cas qui trahissent un calcul en virgule flottante : 0,29 × 100 = 28,999… en flottant.
    expect(parseAmountToCents('0,29')).toBe(29);
    expect(parseAmountToCents('1,15')).toBe(115);
    expect(parseAmountToCents('9999999,99')).toBe(999999999);
  });

  it('saisie refusée : signe, trois décimales, séparateurs multiples, lettres, vide', () => {
    for (const bad of [
      '-5',
      '+5',
      '12,345',
      '1,2,3',
      '1.234,56',
      'abc',
      '',
      ',5',
      '5,',
      '1e3',
      '12345678',
    ]) {
      expect(parseAmountToCents(bad)).toBeNull();
    }
  });

  it('schéma : entier strictement positif et plafonné, jamais de décimale', () => {
    expect(amountCentsSchema.safeParse(4550).success).toBe(true);
    expect(amountCentsSchema.safeParse(MAX_AMOUNT_CENTS).success).toBe(true);
    for (const bad of [0, -1, 45.5, MAX_AMOUNT_CENTS + 1, '4550', Number.NaN]) {
      expect(amountCentsSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('affichage exact : chaîne décimale, format français, négatifs', () => {
    expect(centsToDecimalString(123456)).toBe('1234.56');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(-150)).toBe('-1.50');
    expect(centsToInput(4550)).toBe('45,50');
    // Intl sépare les milliers par une espace fine insécable (U+202F).
    expect(formatCents(123456, 'EUR')).toBe('1 234,56 €');
    expect(formatCents(29, 'EUR')).toBe('0,29 €');
    expect(formatCents(999999999, 'EUR')).toBe('9 999 999,99 €');
    expect(() => centsToDecimalString(1.5)).toThrow(RangeError);
  });
});
