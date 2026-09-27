import { formatCents } from '@dental/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Loading } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatLocalDate, localDateOf } from '../../lib/dates';
import { RECEIVABLES_KEY, useClinic } from '../../lib/queries';

/**
 * « À encaisser » : patients qui doivent encore de l'argent, du plus ancien acte ouvert au plus
 * récent (ADR 0009). Lecture seule ; l'encaissement se fait depuis la fiche du patient.
 */
export function ReceivablesPage() {
  const clinic = useClinic();
  const receivables = useQuery({ queryKey: RECEIVABLES_KEY, queryFn: api.receivables });

  if (receivables.isPending || clinic.isPending) return <Loading />;
  if (receivables.isError) return <Alert>{errorMessage(receivables.error)}</Alert>;
  if (clinic.isError) return <Alert>{errorMessage(clinic.error)}</Alert>;
  const { currency, totalRemainingCents, patients } = receivables.data;
  const timeZone = clinic.data.timezone;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">À encaisser</h1>
        <p className="text-sm text-slate-600">
          Restant dû de tout le cabinet :{' '}
          <strong className="text-base text-slate-900">
            {formatCents(totalRemainingCents, currency)}
          </strong>
        </p>
      </div>
      {patients.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-600">
          Aucun montant restant dû.
        </p>
      ) : (
        <ul
          aria-label="Patients avec un restant dû"
          className="flex flex-col divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white"
        >
          {patients.map((r) => (
            <li key={r.patient.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <Link
                className="min-w-0 font-medium text-sky-800 underline"
                to={`/patients/${r.patient.id}#paiements`}
              >
                {r.patient.lastName.toUpperCase()} {r.patient.firstName}
              </Link>
              <span className="text-sm text-slate-600">
                {r.openCharges} acte{r.openCharges > 1 ? 's' : ''} ouvert
                {r.openCharges > 1 ? 's' : ''} · depuis le{' '}
                {formatLocalDate(localDateOf(r.oldestChargeAt, timeZone))}
              </span>
              <span className="ml-auto font-semibold text-amber-800">
                {formatCents(r.remainingCents, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {patients.length >= 500 && (
        <Alert tone="info">Seuls les 500 patients aux dettes les plus anciennes sont listés.</Alert>
      )}
    </section>
  );
}
