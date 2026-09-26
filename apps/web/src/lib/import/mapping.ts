import {
  IMPORT_LIMITS,
  PATIENT_IMPORT_FIELDS,
  type ImportRowInput,
  type PatientImportField,
} from '@dental/shared';
import type { Table } from './table';

export type Mapping = Record<PatientImportField, number | null>;

export const FIELD_LABELS: Record<PatientImportField, string> = {
  lastName: 'Nom',
  firstName: 'Prénom',
  birthDate: 'Date de naissance',
  phone1: 'Téléphone 1',
  phone2: 'Téléphone 2',
  phone3: 'Téléphone 3',
  email: 'E-mail',
  externalRef: 'N° de dossier (ancien logiciel)',
  administrativeNote: 'Note administrative',
};

export const REQUIRED_FIELDS: readonly PatientImportField[] = ['lastName', 'firstName'];

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// En-têtes usuels (normalisés), du plus au moins spécifique.
const SYNONYMS: Record<PatientImportField, string[]> = {
  lastName: ['nom de famille', 'nom patient', 'nom', 'last name', 'lastname', 'surname'],
  firstName: ['prenom patient', 'prenom', 'first name', 'firstname'],
  birthDate: [
    'date de naissance',
    'date naissance',
    'naissance',
    'ddn',
    'ne le',
    'nee le',
    'birth date',
    'birthdate',
    'dob',
  ],
  phone1: [
    'telephone portable',
    'tel portable',
    'portable',
    'mobile',
    'gsm',
    'telephone 1',
    'tel 1',
    'telephone',
    'tel',
    'phone',
  ],
  phone2: [
    'telephone 2',
    'tel 2',
    'telephone fixe',
    'tel fixe',
    'fixe',
    'domicile',
    'tel domicile',
  ],
  phone3: ['telephone 3', 'tel 3', 'tel travail', 'travail', 'bureau'],
  email: ['adresse email', 'adresse mail', 'e mail', 'email', 'mail', 'courriel'],
  externalRef: [
    'numero de dossier',
    'numero dossier',
    'n dossier',
    'no dossier',
    'dossier',
    'numero patient',
    'n patient',
    'code patient',
    'identifiant',
    'reference',
    'ref',
    'id',
  ],
  administrativeNote: [
    'note administrative',
    'notes',
    'note',
    'remarques',
    'remarque',
    'commentaires',
    'commentaire',
    'observations',
    'observation',
  ],
};

/** Association proposée : correspondance exacte d'abord, chaque colonne n'étant utilisée qu'une fois. */
export function suggestMapping(headers: string[]): Mapping {
  const normalized = headers.map(normalize);
  const used = new Set<number>();
  const mapping = Object.fromEntries(PATIENT_IMPORT_FIELDS.map((f) => [f, null])) as Mapping;
  for (const field of PATIENT_IMPORT_FIELDS) {
    for (const synonym of SYNONYMS[field]) {
      const index = normalized.findIndex((h, i) => !used.has(i) && h === synonym);
      if (index >= 0) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

export function mappingErrors(mapping: Mapping): string[] {
  const errors = REQUIRED_FIELDS.filter((f) => mapping[f] === null).map(
    (f) => `Associez une colonne au champ « ${FIELD_LABELS[f]} ».`,
  );
  const columns = Object.values(mapping).filter((v): v is number => v !== null);
  if (new Set(columns).size !== columns.length)
    errors.push('Une même colonne est associée à deux champs.');
  return errors;
}

// Longueurs maximales acceptées par l'API ; au-delà, la valeur est tronquée ici et signalée
// comme trop longue par le serveur.
const MAX = { name: 500, date: 50, phone: 50, email: 500, ref: 200, note: 5000 };

/** Lignes à envoyer, chacune avec son numéro de ligne dans le fichier (rapport d'anomalies). */
export function mapRows(table: Table, mapping: Mapping): ImportRowInput[] {
  const cell = (row: string[], field: PatientImportField, max: number) => {
    const index = mapping[field];
    return index === null ? undefined : (row[index] ?? '').slice(0, max);
  };
  return table.rows.map((row, i) => ({
    line: table.lines[i] ?? i + 2,
    lastName: cell(row, 'lastName', MAX.name),
    firstName: cell(row, 'firstName', MAX.name),
    birthDate: cell(row, 'birthDate', MAX.date),
    phones: (['phone1', 'phone2', 'phone3'] as const)
      .map((f) => cell(row, f, MAX.phone))
      .filter((v): v is string => v !== undefined && v.trim() !== '')
      .slice(0, IMPORT_LIMITS.maxPhones),
    email: cell(row, 'email', MAX.email),
    externalRef: cell(row, 'externalRef', MAX.ref),
    administrativeNote: cell(row, 'administrativeNote', MAX.note),
  }));
}
