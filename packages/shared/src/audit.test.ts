import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, auditLogQuerySchema } from './audit';
import { AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS, auditActionLabel } from './audit-labels';

describe("contrats du journal d'audit", () => {
  it('chaque action et chaque type d’élément a un libellé distinct', () => {
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual([...AUDIT_ACTIONS].sort());
    expect(Object.keys(AUDIT_ENTITY_LABELS).sort()).toEqual([...AUDIT_ENTITY_TYPES].sort());
    expect(new Set(Object.values(AUDIT_ACTION_LABELS)).size).toBe(AUDIT_ACTIONS.length);
    // Forme domaine.action, identique à la contrainte de la table audit_logs.
    for (const action of AUDIT_ACTIONS) expect(action).toMatch(/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/);
  });

  it('action retirée du catalogue : affichée telle quelle', () => {
    expect(auditActionLabel('patient.medical_notes_read')).toBe('Notes médicales consultées');
    expect(auditActionLabel('ancienne.action')).toBe('ancienne.action');
  });

  it('requête : période valide d’un an au plus, filtres typés, taille de page bornée', () => {
    const base = { from: '2026-09-01', to: '2026-09-30' };
    expect(auditLogQuerySchema.parse(base)).toMatchObject({ ...base, limit: 50 });
    expect(auditLogQuerySchema.parse({ ...base, limit: '100' }).limit).toBe(100);
    for (const bad of [
      { from: '2026-09-30', to: '2026-09-01' },
      { from: '2025-09-01', to: '2026-09-30' },
      { from: '2026-02-30', to: '2026-03-01' },
      { ...base, action: 'patient.exported' },
      { ...base, entityType: 'dossier' },
      { ...base, actorId: 'pas-un-uuid' },
      { ...base, before: '1' },
      { ...base, limit: 101 },
      { ...base, limit: 0 },
    ]) {
      expect(auditLogQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
