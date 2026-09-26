import { describe, expect, it } from 'vitest';
import {
  identityKey,
  normalizeEmail,
  normalizeForSearch,
  normalizePhone,
  parseBirthDate,
} from '../normalize';

const today = new Date('2026-09-26T12:00:00Z');

describe('normalisation', () => {
  it('texte de recherche : accents, casse, ponctuation', () => {
    expect(normalizeForSearch("  Élodie  D'Almeida-Côté ")).toBe('elodie d almeida cote');
  });

  it.each([
    ['06 12 34 56 78', 'FR', '+33612345678'],
    ['0612345678', 'FR', '+33612345678'],
    ['612345678', 'FR', '+33612345678'], // zéro initial perdu par Excel (cellule numérique)
    ['+33 6 12 34 56 78', 'FR', '+33612345678'],
    ['0033612345678', 'FR', '+33612345678'],
    ['06.12.34.56.78', 'FR', '+33612345678'],
    ['0612345678', 'MA', '+212612345678'],
    ['+212 6 12 34 56 78', 'FR', '+212612345678'],
  ])('téléphone %s (%s) → %s', (raw, country, expected) => {
    expect(normalizePhone(raw, country)).toBe(expected);
  });

  it.each(['123', '06 12', 'abc', '0000000000'])('téléphone invalide refusé : %s', (raw) => {
    expect(normalizePhone(raw, 'FR')).toBeNull();
  });

  it('e-mail : minuscules, format vérifié', () => {
    expect(normalizeEmail(' Jean.Dupont@Exemple.FR ')).toBe('jean.dupont@exemple.fr');
    expect(normalizeEmail('jean.dupont@')).toBeNull();
  });

  describe('dates de naissance', () => {
    it.each([
      ['12/03/1985', 'DD/MM/YYYY', '1985-03-12'],
      ['12.03.1985', 'DD/MM/YYYY', '1985-03-12'],
      ['12-03-1985', 'DD/MM/YYYY', '1985-03-12'],
      ['3/12/1985', 'MM/DD/YYYY', '1985-03-12'],
      ['1985-03-12', 'DD/MM/YYYY', '1985-03-12'], // ISO toujours accepté
      ['1985-03-12T00:00:00.000Z', 'DD/MM/YYYY', '1985-03-12'], // cellule date Excel
      ['1985/03/12', 'YYYY-MM-DD', '1985-03-12'],
    ] as const)('%s (%s) → %s', (raw, format, expected) => {
      expect(parseBirthDate(raw, format, today)).toEqual({ ok: true, value: expected });
    });

    it.each([
      ['31/02/1990', 'INVALID_DATE'], // date inexistante
      ['12/03/85', 'INVALID_DATE'], // année à deux chiffres
      ['12/13/1985', 'INVALID_DATE'], // mois 13 en format jour/mois
      ['né en 1985', 'INVALID_DATE'],
      ['01/01/1899', 'DATE_OUT_OF_RANGE'],
      ['01/01/2027', 'DATE_OUT_OF_RANGE'], // dans le futur
    ] as const)('%s → %s', (raw, code) => {
      expect(parseBirthDate(raw, 'DD/MM/YYYY', today)).toEqual({ ok: false, code });
    });
  });

  it("clé d'identité insensible aux accents et à la casse", () => {
    expect(identityKey('DUPONT', 'Hélène', '1980-01-02')).toBe(
      identityKey('Dupont', 'helene', '1980-01-02'),
    );
    expect(identityKey('Dupont', 'Hélène', null)).toBe('dupont|helene|');
  });
});
