import { useEffect, useState, useSyncExternalStore } from 'react';

/** Valeur mise à jour après un délai sans changement (recherche pendant la frappe). */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Heure courante, rafraîchie à intervalle régulier (ligne « maintenant », statuts permis). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Vrai si la requête média correspond (par exemple `(max-width: 639px)` pour un téléphone).
 * Sans `matchMedia` (tests, anciens navigateurs) : faux, donc l'affichage ordinateur.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}

/** Téléphone : moins de 640 px de large (point de rupture `sm` de Tailwind). */
export const PHONE_QUERY = '(max-width: 639px)';
