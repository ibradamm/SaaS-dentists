import { MAX_AMOUNT_CENTS, parseAmountToCents } from '@dental/shared';
import { TextField } from '../../components/ui';

/** Centimes d'une saisie valide (strictement positive, plafonnée), sinon null. */
export function amountOf(value: string): number | null {
  const cents = parseAmountToCents(value);
  return cents !== null && cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

/**
 * Saisie d'un montant en texte (« 45,50 ») : jamais de nombre à virgule, la conversion en
 * centimes se fait sur la chaîne (packages/shared/src/money.ts).
 */
export function AmountField({
  label,
  value,
  onChange,
  currency,
  hint,
  optional = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  currency: string;
  hint?: string;
  optional?: boolean;
  autoFocus?: boolean;
}) {
  const invalid = value.trim() !== '' && amountOf(value) === null;
  return (
    <TextField
      label={`${label} (${currency})`}
      inputMode="decimal"
      autoComplete="off"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={invalid ? 'Montant invalide (exemple : 45,50)' : undefined}
      {...(hint ? { hint } : optional ? { hint: 'Facultatif' } : {})}
    />
  );
}
