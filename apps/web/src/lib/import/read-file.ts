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
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return toTable(parseCsv(decodeText(await file.arrayBuffer())));
  }
  if (name.endsWith('.xlsx')) {
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
