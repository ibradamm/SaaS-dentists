import { describe, expect, it } from 'vitest';
import {
  MFA_REQUIRED_ROLES,
  PERMISSIONS,
  ROLES,
  hasPermission,
  permissionsOf,
  roleHasPermission,
  type Permission,
  type Role,
} from './permissions';

/**
 * Matrice attendue, recopiée à la main depuis docs/ARCHITECTURE.md (section F, réponses O9
 * du 2026-09-26), indépendamment de l'implémentation. Toute modification de droits doit
 * modifier les deux : c'est voulu.
 *                                  ADMIN  DENTIST SECRETARY
 */
const EXPECTED: Record<Permission, [boolean, boolean, boolean]> = {
  'appointment.read': [true, true, true],
  'appointment.write': [true, true, true],
  'schedule.manage_own': [true, true, false],
  'schedule.manage_any': [true, false, true],
  'patient.read': [true, true, true],
  'patient.write': [true, true, true],
  // E18 : l'administrateur n'y a accès que s'il est lui-même praticien (test ci-dessous).
  'patient.medical.read': [false, true, false],
  'patient.medical.write': [false, true, false],
  'payment.read': [true, true, true],
  'payment.write': [true, true, true],
  'payment.void': [true, true, false],
  'finance.reports.read': [true, true, false],
  'clinic.settings.manage': [true, false, false],
  'user.manage': [true, false, false],
  'audit.read': [true, false, false],
  'data.import': [true, false, false],
};

const cases = PERMISSIONS.flatMap((permission) =>
  ROLES.map((role, i) => ({ role, permission, expected: EXPECTED[permission][i] })),
);

describe('matrice rôles × permissions', () => {
  it('couvre exactement le catalogue', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PERMISSIONS].sort());
    expect(cases).toHaveLength(PERMISSIONS.length * ROLES.length);
  });

  it.each(cases)('$role / $permission → $expected', ({ role, permission, expected }) => {
    expect(roleHasPermission(role, permission)).toBe(expected);
  });

  it('sans qualité de praticien, permission effective = matrice des rôles', () => {
    for (const role of ROLES) {
      expect(permissionsOf({ role, isPractitioner: false })).toEqual(
        PERMISSIONS.filter((p) => roleHasPermission(role, p)),
      );
    }
  });

  it('notes médicales : la qualité de praticien ne les ouvre qu’à l’administrateur', () => {
    const medical = ['patient.medical.read', 'patient.medical.write'] as const;
    for (const p of medical) {
      expect(hasPermission({ role: 'ADMIN', isPractitioner: true }, p)).toBe(true);
      expect(hasPermission({ role: 'ADMIN', isPractitioner: false }, p)).toBe(false);
      expect(hasPermission({ role: 'SECRETARY', isPractitioner: true }, p)).toBe(false);
      expect(hasPermission({ role: 'DENTIST', isPractitioner: false }, p)).toBe(true);
    }
    // Rien d'autre ne change pour un administrateur praticien.
    expect(permissionsOf({ role: 'ADMIN', isPractitioner: true })).toEqual([...PERMISSIONS]);
    expect(permissionsOf({ role: 'SECRETARY', isPractitioner: true })).toEqual(
      permissionsOf({ role: 'SECRETARY', isPractitioner: false }),
    );
  });

  it('la double authentification est obligatoire pour ADMIN et DENTIST uniquement', () => {
    const required: Role[] = ROLES.filter((r) => MFA_REQUIRED_ROLES.has(r));
    expect(required).toEqual(['ADMIN', 'DENTIST']);
  });
});
