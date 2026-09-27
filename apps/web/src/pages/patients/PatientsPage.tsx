import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Badge, Loading, SelectField, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import { formatDate } from '../../lib/format-date';
import { formatPhone } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';

const PAGE_SIZE = 25;
const linkButton =
  'inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-700';

export function PatientsPage() {
  const { data: me } = useMe();
  // ?q=… : suite de la recherche rapide de l'en-tête.
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [page, setPage] = useState(0);
  const q = useDebounced(search.trim(), 300);
  const patients = useQuery({
    queryKey: ['patients', q, status, page],
    queryFn: () =>
      api.listPatients({ ...(q ? { q } : {}), status, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const total = patients.data?.total ?? 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <div className="flex flex-wrap gap-2">
          {can(me, 'data.import') && (
            <Link
              to="/patients/import"
              className={`${linkButton} bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50`}
            >
              Importer un fichier
            </Link>
          )}
          {can(me, 'patient.write') && (
            <Link
              to="/patients/nouveau"
              className={`${linkButton} bg-sky-700 text-white hover:bg-sky-800`}
            >
              Nouveau patient
            </Link>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <TextField
          label="Rechercher (nom, téléphone ou date de naissance JJ/MM/AAAA)"
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <SelectField
          label="Statut"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as 'ACTIVE' | 'ARCHIVED');
            setPage(0);
          }}
        >
          <option value="ACTIVE">Actifs</option>
          <option value="ARCHIVED">Archivés</option>
        </SelectField>
      </div>
      {patients.isPending && <Loading />}
      {patients.isError && <Alert>{errorMessage(patients.error)}</Alert>}
      {patients.data && (
        <>
          <p className="text-sm text-slate-600" role="status">
            {total === 0 ? 'Aucun patient trouvé.' : `${total} patient${total > 1 ? 's' : ''}`}
          </p>
          <ul
            className="flex flex-col divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white"
            aria-label="Liste des patients"
          >
            {patients.data.patients.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/patients/${p.id}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-700"
                >
                  <span className="font-medium">
                    {p.lastName.toUpperCase()} {p.firstName}
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                    {p.birthDate && <span>Né(e) le {formatDate(p.birthDate)}</span>}
                    {p.primaryPhone && <span>{formatPhone(p.primaryPhone)}</span>}
                    {p.status === 'ARCHIVED' && <Badge>Archivé</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {total > PAGE_SIZE && (
            <nav
              aria-label="Pagination"
              className="flex items-center justify-between gap-2 text-sm"
            >
              <button
                className="min-h-11 rounded-md px-3 ring-1 ring-slate-300 disabled:text-slate-400"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                Précédent
              </button>
              <span>
                Page {page + 1} sur {Math.ceil(total / PAGE_SIZE)}
              </span>
              <button
                className="min-h-11 rounded-md px-3 ring-1 ring-slate-300 disabled:text-slate-400"
                disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage(page + 1)}
              >
                Suivant
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
