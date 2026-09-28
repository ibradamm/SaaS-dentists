import { IMPORT_LIMITS } from '@dental/shared';
import { FileReadError, decodeText, parseCsv, toTable, type Table } from './table';

/**
 * Lecture d'un fichier dans le navigateur. Le serveur ne reçoit jamais le fichier : seulement
 * les lignes de texte, qu'il valide lui-même.
 */
export async function readTabularFile(file: File): Promise<Table> {
  if (file.size > IMPORT_LIMITS.maxFileBytes) {
    throw new FileReadError('Fichier trop volumineux (10 Mo maximum).');
  }
  const name = file.name.toLowerCase();
  // L'extension choisit le lecteur ; le contenu réel est vérifié avant (signature), sans se
  // fier ni à l'extension ni au type annoncé par le navigateur.
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    if (startsWith(head, ZIP) || startsWith(head, OLE)) {
      throw new FileReadError(
        'Ce fichier est un classeur Excel renommé : enregistrez-le au format .csv, ou importez le .xlsx.',
      );
    }
    if (head.includes(0)) {
      throw new FileReadError("Ce fichier n'est pas un fichier texte (CSV) : contenu binaire.");
    }
    return toTable(parseCsv(decodeText(await file.arrayBuffer())));
  }
  if (name.endsWith('.xlsx')) {
    if (startsWith(head, OLE)) {
      throw new FileReadError(
        'Ancien format Excel (.xls) : enregistrez le fichier au format .xlsx ou .csv.',
      );
    }
    // Un .xlsx est une archive ZIP : tout autre contenu est refusé sans être analysé.
    if (!startsWith(head, ZIP)) {
      throw new FileReadError(
        "Ce fichier n'est pas un classeur Excel (.xlsx) valide. Enregistrez-le à nouveau au format .xlsx ou .csv.",
      );
    }
    // Chargée à la demande : la bibliothèque Excel n'alourdit pas le reste de l'application.
    const { readSheet } = await import('read-excel-file/browser');
    try {
      return toTable(await readSheet(file));
    } catch (error) {
      if (error instanceof FileReadError) throw error;
      throw new FileReadError(
        'Fichier Excel illisible. Enregistrez-le à nouveau au format .xlsx ou .csv.',
      );
    }
  }
  if (name.endsWith('.xls')) {
    throw new FileReadError(
      'Ancien format Excel (.xls) : enregistrez le fichier au format .xlsx ou .csv.',
    );
  }
  throw new FileReadError('Format non pris en charge : utilisez un fichier .csv ou .xlsx.');
}

// Signatures : archive ZIP (classeur .xlsx) et conteneur OLE (ancien .xls).
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((b, i) => bytes[i] === b);
}
