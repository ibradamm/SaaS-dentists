import type { DateFormat } from '@dental/shared';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { z } from 'zod';

/** Texte comparable : minuscules, sans accents ni ponctuation, espaces simples. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Nom saisi : espaces superflus retirés, casse d'origine conservée (aucune donnée inventée). */
export function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function patientSearchText(lastName: string, firstName: string): string {
  return normalizeForSearch(`${lastName} ${firstName}`);
}

/** Téléphone au format international E.164, ou null s'il n'est pas valide pour le pays donné. */
export function normalizePhone(raw: string, country: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  const parsed = parsePhoneNumberFromString(value, country.toUpperCase() as CountryCode);
  return parsed?.isValid() ? parsed.number : null;
}

const emailSchema = z.email().max(254);
export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return emailSchema.safeParse(value).success ? value : null;
}

export type DateParse =
  { ok: true; value: string } | { ok: false; code: 'INVALID_DATE' | 'DATE_OUT_OF_RANGE' };

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const SEPARATED = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/;

function toIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

/**
 * Date de naissance. Une date ISO (AAAA-MM-JJ, y compris celles issues des cellules date
 * d'Excel) est toujours acceptée ; sinon le format choisi pour l'import s'applique. Les années
 * à deux chiffres sont refusées (siècle ambigu).
 */
export function parseBirthDate(raw: string, format: DateFormat, today: Date): DateParse {
  const value = raw.trim();
  let iso: string | null = null;
  const isoMatch = ISO.exec(value);
  if (isoMatch) {
    iso = toIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  } else {
    const m = SEPARATED.exec(value);
    if (m) {
      const [a, b, c] = [m[1] ?? '', m[2] ?? '', m[3] ?? ''];
      const parts =
        format === 'DD/MM/YYYY'
          ? { d: a, mo: b, y: c }
          : format === 'MM/DD/YYYY'
            ? { d: b, mo: a, y: c }
            : { d: c, mo: b, y: a };
      if (parts.y.length === 4) iso = toIso(Number(parts.y), Number(parts.mo), Number(parts.d));
    }
  }
  if (!iso) return { ok: false, code: 'INVALID_DATE' };
  const todayIso = today.toISOString().slice(0, 10);
  if (iso < '1900-01-01' || iso > todayIso) return { ok: false, code: 'DATE_OUT_OF_RANGE' };
  return { ok: true, value: iso };
}

/** Clé d'identité pour les doublons : nom et prénom normalisés, date de naissance si connue. */
export function identityKey(lastName: string, firstName: string, birthDate: string | null): string {
  return `${normalizeForSearch(lastName)}|${normalizeForSearch(firstName)}|${birthDate ?? ''}`;
}
