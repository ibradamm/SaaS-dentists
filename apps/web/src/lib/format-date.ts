/*
 * Mise en forme des dates, séparée de celle des téléphones : la bibliothèque des numéros
 * (plus de 100 ko) ne doit être chargée qu'avec les pages qui affichent un numéro (ADR 0008).
 */

/** Date AAAA-MM-JJ affichée en JJ/MM/AAAA. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
