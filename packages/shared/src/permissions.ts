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

/**
 * Notes médicales (écart E18, choix le plus restrictif retenu pour le MVP) : rôle Dentiste, ou
 * administrateur lui-même praticien actif du cabinet (compte lié à un praticien, `hasPermission`).
 * Le rôle Administrateur seul n'y donne pas accès ; la secrétaire n'y a jamais accès.
 */
export const MEDICAL_PERMISSIONS: readonly Permission[] = [
  'patient.medical.read',
  'patient.medical.write',
];

const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter(
  (p) => !MEDICAL_PERMISSIONS.includes(p),
);

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

/** Matrice des rôles seule, sans la qualité de praticien : voir `hasPermission`. */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Qui agit dans un cabinet : son rôle, et si son compte est lié à un praticien actif. */
export interface PermissionHolder {
  role: Role;
  isPractitioner: boolean;
}

/**
 * Permission effective : celles du rôle, plus les notes médicales pour un administrateur
 * praticien. Seule fonction à utiliser pour décider d'un accès (serveur et interface).
 */
export function hasPermission(holder: PermissionHolder, permission: Permission): boolean {
  if (ROLE_PERMISSIONS[holder.role].has(permission)) return true;
  return (
    holder.role === 'ADMIN' && holder.isPractitioner && MEDICAL_PERMISSIONS.includes(permission)
  );
}

export function permissionsOf(holder: PermissionHolder): Permission[] {
  return PERMISSIONS.filter((p) => hasPermission(holder, p));
}

/** Rôles pour lesquels la double authentification est obligatoire. */
export const MFA_REQUIRED_ROLES: ReadonlySet<Role> = new Set<Role>(['ADMIN', 'DENTIST']);
