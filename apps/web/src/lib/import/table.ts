import { IMPORT_LIMITS } from '@dental/shared';
import Papa from 'papaparse';

/** Tableau lu depuis un fichier : en-têtes (première ligne) et lignes de données en texte. */
export interface Table {
  headers: string[];
  rows: string[][];
  /** Numéro de ligne dans le fichier (tel qu'Excel l'affiche) de chaque ligne de `rows`. */
  lines: number[];
}

export class FileReadError extends Error {}

/**
 * Décode un CSV : UTF-8 (avec ou sans BOM) si le contenu est valide, sinon Windows-1252,
 * l'encodage des CSV enregistrés par Excel sous Windows en français.
 */
export function decodeText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/**
 * Séparateur détecté automatiquement (point-virgule, virgule, tabulation…). Les lignes vides
 * sont conservées ici pour que la numérotation corresponde au fichier ; `toTable` les écarte.
 */
export function parseCsv(text: string): string[][] {
  // Détection sur les premières lignes non vides : les lignes vides faussent le choix du séparateur.
  const { delimiter } = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', preview: 50 }).meta;
  return Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false }).data;
}

/** Valeur d'une cellule Excel en texte ; une cellule date devient AAAA-MM-JJ (sans ambiguïté). */
export function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
  if (typeof value === 'string' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Construit le tableau et vérifie les limites (lignes, colonnes, en-tête présent). `raw` commence
 * à la première ligne du fichier : les lignes vides sont écartées sans décaler la numérotation.
 */
export function toTable(raw: unknown[][]): Table {
  const matrix = raw
    .map((row, index) => ({ cells: row.map(cellToText), line: index + 1 }))
    .filter((row) => row.cells.some((cell) => cell.trim() !== ''));
  const [first, ...data] = matrix;
  const header = first?.cells;
  const rows = data.map((r) => r.cells);
  if (!header) throw new FileReadError('Le fichier est vide.');
  if (header.length > IMPORT_LIMITS.maxColumns) {
    throw new FileReadError(
      `Trop de colonnes (${header.length}, maximum ${IMPORT_LIMITS.maxColumns}).`,
    );
  }
  if (rows.length === 0) throw new FileReadError("Le fichier ne contient qu'une ligne d'en-têtes.");
  if (rows.length > IMPORT_LIMITS.maxRows) {
    throw new FileReadError(
      `Trop de lignes (${rows.length}, maximum ${IMPORT_LIMITS.maxRows}). Découpez le fichier.`,
    );
  }
  const headers = header.map((h, i) => h.trim() || `Colonne ${i + 1}`);
  return { headers, rows, lines: data.map((r) => r.line) };
}
