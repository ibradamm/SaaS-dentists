import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

/*
 * Composants d'interface minimaux, écrits à la main (le registre shadcn/ui n'est pas joignable
 * depuis l'environnement de développement). Accessibles : libellés associés, erreurs annoncées,
 * focus visible, cibles tactiles d'au moins 44 px.
 */

type ButtonVariant = 'primary' | 'secondary' | 'danger';
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-sky-700 text-white hover:bg-sky-800 disabled:bg-sky-300',
  secondary:
    'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:text-red-300',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function TextField({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | undefined;
  hint?: string;
}) {
  const id = useId();
  const described = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-base focus-visible:border-sky-700 focus-visible:outline-2 focus-visible:outline-sky-700 aria-invalid:border-red-600"
      />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <select
        id={id}
        {...props}
        className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-base focus-visible:outline-2 focus-visible:outline-sky-700"
      >
        {children}
      </select>
    </div>
  );
}

export function Alert({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info' | 'success';
  children: ReactNode;
}) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${styles}`}
    >
      {children}
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">{title}</h1>
      {children}
    </section>
  );
}

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <p role="status" className="p-6 text-slate-600">
      {label}
    </p>
  );
}

/** Mise en page des écrans de connexion (centrée, adaptée au téléphone). */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-8">
      <Card title={title}>{children}</Card>
    </main>
  );
}
