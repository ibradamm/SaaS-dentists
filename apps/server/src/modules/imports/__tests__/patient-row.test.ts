import { describe, expect, it } from 'vitest';
import { validatePatientRow } from '../patient-row';

const ctx = {
  dateFormat: 'DD/MM/YYYY' as const,
  country: 'FR',
  today: new Date('2026-09-26T12:00:00Z'),
};

describe('validation d’une ligne patient', () => {
  it('ligne complète valide, normalisée', () => {
    const result = validatePatientRow(
      {
        line: 2,
        lastName: '  DUPONT ',
        firstName: 'Jean  Marc',
        birthDate: '12/03/1985',
        phones: ['06 12 34 56 78', '+33612345678', ''],
        email: 'Jean@Exemple.fr',
        externalRef: ' D-0042 ',
        administrativeNote: 'Préfère les rendez-vous le matin',
      },
      ctx,
    );
    expect(result).toEqual({
      status: 'VALID',
      issues: [],
      identityKey: 'dupont|jean marc|1985-03-12',
      data: {
        lastName: 'DUPONT',
        firstName: 'Jean Marc',
        birthDate: '1985-03-12',
        phones: ['+33612345678'],
        email: 'jean@exemple.fr',
        externalRef: 'D-0042',
        administrativeNote: 'Préfère les rendez-vous le matin',
      },
    });
  });

  it('nom ou prénom manquant : ligne refusée', () => {
    const result = validatePatientRow({ line: 3, lastName: 'Martin', phones: [] }, ctx);
    expect(result).toEqual({
      status: 'INVALID',
      issues: [{ field: 'firstName', code: 'REQUIRED', severity: 'error' }],
    });
  });

  it('champs facultatifs invalides : ligne acceptée sans eux, avec avertissements', () => {
    const result = validatePatientRow(
      {
        line: 4,
        lastName: 'Martin',
        firstName: 'Léa',
        birthDate: '31/02/1990',
        phones: ['123'],
        email: 'pas-un-email',
      },
      ctx,
    );
    expect(result.status).toBe('VALID');
    expect(result.issues).toEqual([
      { field: 'birthDate', code: 'INVALID_DATE', severity: 'warning' },
      { field: 'phone1', code: 'INVALID_PHONE', severity: 'warning' },
      { field: 'email', code: 'INVALID_EMAIL', severity: 'warning' },
    ]);
    if (result.status === 'VALID') {
      expect(result.data).toMatchObject({ birthDate: null, phones: [], email: null });
    }
  });

  it('nom trop long : ligne refusée', () => {
    const result = validatePatientRow(
      { line: 5, lastName: 'x'.repeat(101), firstName: 'A', phones: [] },
      ctx,
    );
    expect(result.status).toBe('INVALID');
  });
});
