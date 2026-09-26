import { z } from 'zod';

/**
 * Catalogue des permissions et matrice des rôles système (docs/ARCHITECTURE.md, section F).
 * Source unique : le serveur l'applique, l'interface s'en sert uniquement pour masquer les
 * actions non permises. Une permission absente de ce catalogue ne peut pas exister.
 */
export const PERMISSIONS = [
  'appointment.read',
  'appointment.write',
  // Horaires et blocages : ses propres agendas (dentiste) ou ceux de tout praticien.
  'schedule.manage_own',
  'schedule.manage_any',
  'patient.read',
  'patient.write',
  'patient.medical.read',
  'patient.medical.write',
  'payment.read',
  'payment.write',
  'payment.void',
  'finance.reports.read',
  'clinic.settings.manage',
  'user.manage',
  'audit.read',
  // Import en masse de données (fichiers CSV / Excel) : opération sensible, administrateur.
  'data.import',
] as const;

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export const ROLES = ['ADMIN', 'DENTIST', 'SECRETARY'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrateur',
  DENTIST: 'Dentiste',
  SECRETARY: 'Secrétaire',
};

const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const DENTIST_PERMISSIONS: readonly Permission[] = [
  'appointment.read',
  'appointment.write',
  'schedule.manage_own',
  'patient.read',
  'patient.write',
  'patient.medical.read',
  'patient.medical.write',
  'payment.read',
  'payment.write',
  'payment.void',
  'finance.reports.read',
];

// Réponses validées le 2026-09-26 (question O9) : pas de chiffre d'affaires, pas d'annulation
// de paiement, gestion de l'agenda de tout praticien.
const SECRETARY_PERMISSIONS: readonly Permission[] = [
  'appointment.read',
  'appointment.write',
  'schedule.manage_any',
  'patient.read',
  'patient.write',
  'payment.read',
  'payment.write',
];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  ADMIN: new Set(ADMIN_PERMISSIONS),
  DENTIST: new Set(DENTIST_PERMISSIONS),
  SECRETARY: new Set(SECRETARY_PERMISSIONS),
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function permissionsOf(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => ROLE_PERMISSIONS[role].has(p));
}

/** Rôles pour lesquels la double authentification est obligatoire. */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(['ADMIN', 'DENTIST']);
