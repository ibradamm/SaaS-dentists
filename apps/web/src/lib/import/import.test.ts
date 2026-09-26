import { describe, expect, it } from 'vitest';
import { mapRows, mappingErrors, suggestMapping } from './mapping';
import { cellToText, decodeText, parseCsv, toTable } from './table';

const encodeLatin1 = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0))).buffer;

describe('lecture des fichiers', () => {
  it('décode UTF-8, avec ou sans BOM', () => {
    const utf8 = new TextEncoder().encode('Prénom;Hélène');
    expect(decodeText(utf8.buffer)).toBe('Prénom;Hélène');
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    expect(decodeText(withBom.buffer)).toBe('Prénom;Hélène');
  });

  it('décode Windows-1252 (CSV Excel français) quand le contenu n’est pas de l’UTF-8', () => {
    expect(decodeText(encodeLatin1('Prénom;Hélène'))).toBe('Prénom;Hélène');
  });

  it('détecte le séparateur et gère les guillemets', () => {
    expect(toTable(parseCsv('Nom;Prénom\nDupont;"Jean;Marc"\n\n')).rows).toEqual([
      ['Dupont', 'Jean;Marc'],
    ]);
    expect(toTable(parseCsv('Nom,Prénom\r\nMartin,Léa\r\n')).rows).toEqual([['Martin', 'Léa']]);
  });

  it('cellules Excel : date sans ambiguïté, entier sans notation scientifique', () => {
    expect(cellToText(new Date(Date.UTC(1985, 2, 12)))).toBe('1985-03-12');
    expect(cellToText(612345678)).toBe('612345678');
    expect(cellToText(null)).toBe('');
  });

  it('tableau : lignes vides ignorées, en-têtes manquants nommés, fichier vide refusé', () => {
    const table = toTable([
      ['Nom', ''],
      ['', ''],
      ['Dupont', 'Jean'],
    ]);
    expect(table).toEqual({
      headers: ['Nom', 'Colonne 2'],
      rows: [['Dupont', 'Jean']],
      lines: [3],
    });
    expect(() => toTable([])).toThrow('vide');
    expect(() => toTable([['Nom']])).toThrow("qu'une ligne");
  });
});

describe('association des colonnes', () => {
  it('propose les champs à partir d’en-têtes usuels', () => {
    const mapping = suggestMapping([
      'N° dossier',
      'NOM',
      'Prénom',
      'Date de naissance',
      'Portable',
      'Tél. fixe',
      'E-mail',
      'Remarques',
      'Ville',
    ]);
    expect(mapping).toEqual({
      externalRef: 0,
      lastName: 1,
      firstName: 2,
      birthDate: 3,
      phone1: 4,
      phone2: 5,
      phone3: null,
      email: 6,
      administrativeNote: 7,
    });
  });

  it('signale les champs obligatoires manquants et les colonnes en double', () => {
    const mapping = suggestMapping(['Nom']);
    expect(mappingErrors(mapping)).toEqual(['Associez une colonne au champ « Prénom ».']);
    expect(mappingErrors({ ...mapping, firstName: 0 })).toEqual([
      'Une même colonne est associée à deux champs.',
    ]);
  });

  it('construit les lignes à envoyer avec les numéros de ligne du fichier', () => {
    // Une ligne vide (ou faite de séparateurs) ne décale pas la numérotation.
    const table = toTable(
      parseCsv('Nom;Prénom;Tel;Tel2\nDupont;Jean;0612345678;\n;;;\nMartin;Léa;;0145678910\n'),
    );
    const rows = mapRows(table, { ...suggestMapping(table.headers), phone2: 3 });
    expect(rows).toEqual([
      {
        line: 2,
        lastName: 'Dupont',
        firstName: 'Jean',
        birthDate: undefined,
        phones: ['0612345678'],
        email: undefined,
        externalRef: undefined,
        administrativeNote: undefined,
      },
      {
        line: 4,
        lastName: 'Martin',
        firstName: 'Léa',
        birthDate: undefined,
        phones: ['0145678910'],
        email: undefined,
        externalRef: undefined,
        administrativeNote: undefined,
      },
    ]);
  });
});
