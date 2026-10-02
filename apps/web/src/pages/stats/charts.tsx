import { useId, useState, type ReactNode } from 'react';

/*
 * Graphiques du tableau de bord, écrits à la main (aucune bibliothèque : poids). Palette
 * catégorielle en ordre fixe, validée pour la vision des couleurs (scripts du guide de
 * visualisation) : bleu, orange, turquoise. Le turquoise étant sous 3:1 de contraste, chaque
 * graphique a une légende et un tableau des valeurs. Le texte n'est jamais dans la couleur
 * d'une série.
 */
export const SERIES = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a' } as const;
/** Piste d'une jauge : un pas clair de la même rampe que le remplissage. */
const TRACK = '#cde2fb';

/** Maximum « rond » de l'axe (1, 2 ou 5 × 10ⁿ) au moins égal à la plus grande valeur. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value)!;
  return step * power;
}

export interface Series<K extends string> {
  key: K;
  label: string;
  color: string;
}

export interface Bucket<K extends string> {
  start: string;
  label: string;
  tick: string;
  values: Record<K, number>;
}

function Legend<K extends string>({ series }: { series: readonly Series<K>[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span aria-hidden className="size-3 rounded-sm" style={{ backgroundColor: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function ValuesTable<K extends string>({
  caption,
  buckets,
  series,
  format,
}: {
  caption: string;
  buckets: readonly Bucket<K>[];
  series: readonly Series<K>[];
  format: (n: number) => string;
}) {
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sky-800 underline">
        Voir les valeurs
      </summary>
      <div className="max-h-72 overflow-auto">
        <table className="w-full">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-600">
              <th scope="col" className="py-1 pr-2 font-medium">
                Période
              </th>
              {series.map((s) => (
                <th key={s.key} scope="col" className="py-1 pl-2 text-right font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start} className="border-b border-slate-100">
                <th scope="row" className="py-1 pr-2 text-left font-normal first-letter:uppercase">
                  {b.label}
                </th>
                {series.map((s) => (
                  <td key={s.key} className="py-1 pl-2 text-right tabular-nums">
                    {format(b.values[s.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Colonnes dans le temps, empilées s'il y a plusieurs séries. Chaque colonne est accessible au
 * clavier et affiche ses valeurs au survol ou au focus ; le tableau donne toutes les valeurs.
 */
export function ColumnChart<K extends string>({
  title,
  buckets,
  series,
  format,
  empty,
}: {
  title: string;
  buckets: readonly Bucket<K>[];
  series: readonly Series<K>[];
  format: (n: number) => string;
  empty: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const total = (b: Bucket<K>) => series.reduce((s, x) => s + b.values[x.key], 0);
  const max = niceMax(Math.max(0, ...buckets.map(total)));
  const every = Math.max(1, Math.ceil(buckets.length / 8));
  const hovered = active === null ? null : buckets[active];
  const nothing = buckets.every((b) => total(b) === 0);

  return (
    <figure className="flex min-w-0 flex-col gap-2" aria-labelledby={`${id}-titre`}>
      <h3 id={`${id}-titre`} className="font-semibold">
        {title}
      </h3>
      {series.length > 1 && <Legend series={series} />}
      {nothing ? (
        <p className="text-sm text-slate-600">{empty}</p>
      ) : (
        <>
          <div className="relative">
            <div className="flex justify-between text-xs text-slate-500 tabular-nums">
              <span>{format(max)}</span>
            </div>
            <div
              role="group"
              aria-label={title}
              className="relative mt-1 flex h-40 items-end gap-[2px] border-b border-slate-300"
              onMouseLeave={() => setActive(null)}
            >
              {/* Repères : lignes fines, pleines, discrètes. */}
              <div aria-hidden className="absolute inset-x-0 top-0 border-t border-slate-200" />
              <div aria-hidden className="absolute inset-x-0 top-1/2 border-t border-slate-200" />
              {buckets.map((b, i) => (
                <div
                  key={b.start}
                  // Colonne nommée : un nom sur un div sans rôle n'est pas annoncé (axe
                  // « aria-prohibited-attr », trouvé en Phase 10).
                  role="img"
                  tabIndex={0}
                  aria-label={`${b.label} : ${series.map((s) => `${s.label} ${format(b.values[s.key])}`).join(', ')}`}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center rounded-sm outline-offset-1 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-700"
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  <div
                    className="flex w-full max-w-6 flex-col-reverse gap-[2px]"
                    style={{ height: `${(total(b) / max) * 100}%` }}
                  >
                    {series.map((s, j) => {
                      const value = b.values[s.key];
                      if (value === 0) return null;
                      const top = series.slice(j + 1).every((x) => b.values[x.key] === 0);
                      return (
                        <div
                          key={s.key}
                          className={top ? 'rounded-t' : ''}
                          style={{
                            backgroundColor: s.color,
                            flexGrow: value,
                            flexBasis: 0,
                            minHeight: 2,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {hovered && (
              <div
                role="status"
                className="pointer-events-none absolute top-0 right-0 z-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
              >
                <p className="font-medium first-letter:uppercase">{hovered.label}</p>
                <ul>
                  {series.map((s) => (
                    <li key={s.key} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-0.5 w-3"
                        style={{ backgroundColor: s.color }}
                      />
                      <strong className="tabular-nums">{format(hovered.values[s.key])}</strong>
                      <span className="text-slate-600">{s.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div aria-hidden className="flex gap-[2px] text-[11px] text-slate-500">
            {buckets.map((b, i) => (
              <span
                key={b.start}
                className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap"
              >
                {i % every === 0 ? b.tick : ''}
              </span>
            ))}
          </div>
          <ValuesTable caption={title} buckets={buckets} series={series} format={format} />
        </>
      )}
    </figure>
  );
}

/** Barres horizontales d'une seule série, valeur écrite au bout de chaque barre. */
export function BarList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: readonly { key: string; label: ReactNode; value: number; display: string }[];
  empty: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      {rows.length === 0 || max === 0 ? (
        <p className="text-sm text-slate-600">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((r) => (
            <li
              key={r.key}
              className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2"
            >
              <span className="truncate">{r.label}</span>
              <span aria-hidden className="h-3">
                <span
                  className="block h-3 rounded-r"
                  style={{
                    width: `${(r.value / max) * 100}%`,
                    minWidth: r.value > 0 ? 2 : 0,
                    backgroundColor: SERIES.blue,
                  }}
                />
              </span>
              <span className="text-right tabular-nums">{r.display}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Jauge d'un taux (occupation) ; « — » sans donnée. */
export function Meter({ rate, label }: { rate: number | null; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="block h-2.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: TRACK }}
    >
      {rate !== null && (
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.min(1, rate) * 100}%`, backgroundColor: SERIES.blue }}
        />
      )}
    </span>
  );
}
