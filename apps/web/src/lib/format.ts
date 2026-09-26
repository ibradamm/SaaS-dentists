import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/** Numéro E.164 affiché au format national du pays du numéro (06 12 34 56 78). */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  return parsePhoneNumberFromString(e164)?.formatNational() ?? e164;
}

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
