import type { Relationship } from '@dental/shared';

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  SELF: 'Patient',
  GUARDIAN: 'Responsable légal',
  OTHER: 'Autre',
};
