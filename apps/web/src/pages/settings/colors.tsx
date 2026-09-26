import { SelectField } from '../../components/ui';

/** Couleurs proposées pour l'agenda (contraste suffisant sur fond blanc pour une pastille). */
export const COLORS = [
  { value: '#0ea5e9', label: 'Bleu' },
  { value: '#10b981', label: 'Vert' },
  { value: '#f59e0b', label: 'Ambre' },
  { value: '#f43f5e', label: 'Rose' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#14b8a6', label: 'Turquoise' },
  { value: '#f97316', label: 'Orange' },
  { value: '#64748b', label: 'Gris' },
] as const;

export function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-4 w-4 shrink-0 rounded-full ring-1 ring-slate-300"
      style={{ backgroundColor: color }}
    />
  );
}

export function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const known = COLORS.some((c) => c.value === value);
  return (
    <div className="flex items-end gap-2">
      <div className="grow">
        <SelectField
          label="Couleur"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {!known && <option value={value}>Personnalisée ({value})</option>}
          {COLORS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </SelectField>
      </div>
      <span className="mb-3.5">
        <ColorSwatch color={value} />
      </span>
    </div>
  );
}
