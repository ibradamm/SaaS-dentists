import { describe, expect, it } from 'vitest';
import {
  MFA_REQUIRED_ROLES,
  PERMISSIONS,
  ROLES,
  permissionsOf,
  roleHasPermission,
  type Permission,
  type Role,
} from './permissions';

/**
 * Matrice attendue, recopiée à la main depuis docs/ARCHITECTURE.md (section I.2, réponses O9
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
  'patient.medical.read': [true, true, false],
  'patient.medical.write': [true, true, false],
  'payment.read': [true, true, true],
  'payment.write': [true, true, true],
  'payment.void': [true, true, false],
  'finance.reports.read': [true, true, false],
  'conversation.read': [true, true, true],
  'conversation.reply': [true, true, true],
  'clinic.settings.manage': [true, false, false],
  'user.manage': [true, false, false],
  'audit.read': [true, false, false],
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

  it('permissionsOf est cohérent avec roleHasPermission', () => {
    for (const role of ROLES) {
      expect(permissionsOf(role)).toEqual(PERMISSIONS.filter((p) => roleHasPermission(role, p)));
    }
  });

  it('la double authentification est obligatoire pour ADMIN et DENTIST uniquement', () => {
    const required: Role[] = ROLES.filter((r) => MFA_REQUIRED_ROLES.has(r));
    expect(required).toEqual(['ADMIN', 'DENTIST']);
  });
});
