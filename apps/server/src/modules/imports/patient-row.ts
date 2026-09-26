import type { DateFormat, ImportIssue, ImportRowInput } from '@dental/shared';
import {
  cleanName,
  identityKey,
  normalizeEmail,
  normalizePhone,
  parseBirthDate,
} from '../patients/normalize';

export interface NormalizedPatientRow {
  lastName: string;
  firstName: string;
  birthDate: string | null;
  phones: string[];
  email: string | null;
  externalRef: string | null;
  administrativeNote: string | null;
}

export type RowValidation =
  | { status: 'INVALID'; issues: ImportIssue[] }
  | {
      status: 'VALID';
      issues: ImportIssue[];
      data: NormalizedPatientRow;
      identityKey: string;
    };

const error = (field: string, code: ImportIssue['code']): ImportIssue => ({
  field,
  code,
  severity: 'error',
});
const warning = (field: string, code: ImportIssue['code']): ImportIssue => ({
  field,
  code,
  severity: 'warning',
});

const LIMITS = { name: 100, externalRef: 64, note: 1000 };

/**
 * Valide et normalise une ligne de patient. Champs obligatoires absents ou invalides : ligne
 * refusée. Champ facultatif invalide : ligne acceptée sans ce champ, avec un avertissement.
 * Aucune valeur n'est devinée ni corrigée au-delà des espaces et du format.
 */
export function validatePatientRow(
  row: ImportRowInput,
  context: { dateFormat: DateFormat; country: string; today: Date },
): RowValidation {
  const issues: ImportIssue[] = [];
  const lastName = cleanName(row.lastName ?? '');
  const firstName = cleanName(row.firstName ?? '');
  if (lastName === '') issues.push(error('lastName', 'REQUIRED'));
  else if (lastName.length > LIMITS.name) issues.push(error('lastName', 'TOO_LONG'));
  if (firstName === '') issues.push(error('firstName', 'REQUIRED'));
  else if (firstName.length > LIMITS.name) issues.push(error('firstName', 'TOO_LONG'));

  let birthDate: string | null = null;
  if (row.birthDate && row.birthDate.trim() !== '') {
    const parsed = parseBirthDate(row.birthDate, context.dateFormat, context.today);
    if (parsed.ok) birthDate = parsed.value;
    else issues.push(warning('birthDate', parsed.code));
  }

  const phones: string[] = [];
  (row.phones ?? []).forEach((raw, index) => {
    if (raw.trim() === '') return;
    const phone = normalizePhone(raw, context.country);
    if (!phone) issues.push(warning(`phone${index + 1}`, 'INVALID_PHONE'));
    else if (!phones.includes(phone)) phones.push(phone);
  });

  let email: string | null = null;
  if (row.email && row.email.trim() !== '') {
    email = normalizeEmail(row.email);
    if (!email) issues.push(warning('email', 'INVALID_EMAIL'));
  }

  let externalRef: string | null = null;
  const ref = row.externalRef?.trim() ?? '';
  if (ref !== '') {
    if (ref.length > LIMITS.externalRef) issues.push(warning('externalRef', 'TOO_LONG'));
    else externalRef = ref;
  }

  let administrativeNote: string | null = null;
  const note = row.administrativeNote?.trim() ?? '';
  if (note !== '') {
    if (note.length > LIMITS.note) issues.push(warning('administrativeNote', 'TOO_LONG'));
    else administrativeNote = note;
  }

  if (issues.some((i) => i.severity === 'error')) return { status: 'INVALID', issues };
  return {
    status: 'VALID',
    issues,
    data: { lastName, firstName, birthDate, phones, email, externalRef, administrativeNote },
    identityKey: identityKey(lastName, firstName, birthDate),
  };
}
