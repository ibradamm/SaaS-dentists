import { useState } from 'react';
import { ApiError } from '../../lib/api';

/** UUID v4. `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS, localhost). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Clé d'idempotence d'une saisie (ADR 0009, F6). Tant que l'issue d'un envoi est inconnue
 * (réseau coupé, erreur serveur), chaque nouvel essai garde la même clé : le serveur renvoie la
 * saisie déjà enregistrée au lieu d'en créer une seconde. Nouvelle clé après un succès, ou après
 * un refus du serveur (4xx) : rien n'a été créé, ou la clé désigne déjà une autre saisie.
 */
export function useIdempotencyKey() {
  const [key, setKey] = useState(newIdempotencyKey);
  const renew = () => setKey(newIdempotencyKey());
  return {
    key,
    renew,
    afterError: (error: unknown) => {
      if (error instanceof ApiError && error.status < 500) renew();
    },
  };
}
