import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/format-date';
import { useDebounced } from '../lib/hooks';

/**
 * Recherche rapide d'un patient depuis n'importe quelle page (parcours « appel téléphonique »,
 * ADR 0008). Nom, téléphone ou date de naissance ; la recherche se fait côté serveur, qui
 * applique les droits et l'isolation du cabinet.
 */
export function PatientQuickSearch({ onNavigate }: { onNavigate?: () => void }) {
  const id = useId();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);
  const active = term.length >= 2 && search.trim().length >= 2;
  const results = useQuery({
    queryKey: ['patients', 'recherche-rapide', term],
    queryFn: () => api.listPatients({ q: term, status: 'ACTIVE', limit: 6 }),
    enabled: active,
  });
  const done = () => {
    setSearch('');
    onNavigate?.();
  };

  return (
    <div role="search" className="relative w-full md:w-72">
      <label htmlFor={id} className="sr-only">
        Rechercher un patient
      </label>
      <input
        id={id}
        type="search"
        autoComplete="off"
        placeholder="Rechercher un patient…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSearch('');
        }}
        className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base focus-visible:border-sky-700 focus-visible:outline-2 focus-visible:outline-sky-700"
      />
      {active && (
        <div className="absolute inset-x-0 z-40 mt-1 rounded-md border border-slate-200 bg-white p-1 shadow-lg md:min-w-80">
          {results.isPending && <p className="p-2 text-sm text-slate-600">Recherche…</p>}
          {results.isError && (
            <p className="p-2 text-sm text-red-700">{errorMessage(results.error)}</p>
          )}
          {results.data && (
            <ul aria-label="Patients trouvés">
              {results.data.patients.length === 0 && (
                <li className="p-2 text-sm text-slate-600">Aucun patient trouvé.</li>
              )}
              {results.data.patients.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/patients/${p.id}`}
                    onClick={done}
                    className="flex min-h-11 flex-wrap items-center gap-x-2 rounded px-2 text-sm hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-700"
                  >
                    <span className="font-medium">
                      {p.lastName.toUpperCase()} {p.firstName}
                    </span>
                    {p.birthDate && (
                      <span className="text-slate-600">né(e) le {formatDate(p.birthDate)}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {results.data && results.data.total > results.data.patients.length && (
            <Link
              to={`/patients?q=${encodeURIComponent(term)}`}
              onClick={done}
              className="flex min-h-11 items-center rounded px-2 text-sm text-sky-800 underline"
            >
              Voir les {results.data.total} résultats
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
