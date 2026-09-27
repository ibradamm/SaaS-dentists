import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/** Numéro E.164 affiché au format national du pays du numéro (06 12 34 56 78). */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  return parsePhoneNumberFromString(e164)?.formatNational() ?? e164;
}
