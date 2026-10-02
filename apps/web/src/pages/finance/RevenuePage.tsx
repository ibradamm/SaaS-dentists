import {
  MAX_JOURNAL_PAYMENTS,
  periodError,
  formatCents,
  type PaymentsJournalResponse,
} from '@dental/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Alert, Badge, Loading, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { addDays, formatLocalDate, formatTime, localDateOf, todayIn } from '../../lib/dates';
import { useNow } from '../../lib/hooks';
import { REVENUE_KEY, useClinic } from '../../lib/queries';
import { PAYMENT_METHOD_LABELS } from './labels';

/** Périodes proposées, en dates locales du cabinet. */
export function periodPresets(today: string) {
  const monthStart = `${today.slice(0, 8)}01`;
  const previousEnd = addDays(monthStart, -1);
  return [
    { label: 'Aujourd’hui', from: today, to: today },
    { label: '7 derniers jours', from: addDays(today, -6), to: today },
    { label: 'Ce mois-ci', from: monthStart, to: today },
    { label: 'Mois précédent', from: `${previousEnd.slice(0, 8)}01`, to: previousEnd },
  ];
}

/**
 * Revenus encaissés (ADR 0009) : sommes réellement reçues sur la période, en jours du cabinet.
 * Les paiements annulés sont montrés à part et jamais comptés ; le restant dû est celui de tout
 * le cabinet, à l'instant de la consultation.
 */
export function RevenuePage() {
  const clinic = useClinic();
  const now = useNow();
  const [params, setParams] = useSearchParams();

  if (clinic.isPending) return <Loading />;
  if (clinic.isError) return <Alert>{errorMessage(clinic.error)}</Alert>;
  const timeZone = clinic.data.timezone;
  const presets = periodPresets(todayIn(timeZone, new Date(now)));
  const month = presets[2]!;
  const from = params.get('du') ?? month.from;
  const to = params.get('au') ?? month.to;
  const setPeriod = (next: { from: string; to: string }) =>
    setParams({ du: next.from, au: next.to }, { replace: true });
  const error = periodError(from, to);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Revenus encaissés</h1>
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div role="group" aria-label="Période" className="flex flex-wrap gap-2">
          {presets.map((p) => {
            const active = p.from === from && p.to === to;
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={active}
                onClick={() => setPeriod(p)}
                className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ring-1 focus-visible:outline-2 focus-visible:outline-sky-700 ${
                  active
                    ? 'bg-sky-100 text-sky-900 ring-sky-300'
                    : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
          <TextField
            label="Du"
            type="date"
            value={from}
            onChange={(e) => setPeriod({ from: e.target.value, to })}
          />
          <TextField
            label="Au"
            type="date"
            value={to}
            onChange={(e) => setPeriod({ from, to: e.target.value })}
          />
        </div>
        {error && <Alert tone="warning">{error}</Alert>}
      </div>
      {!error && <Report from={from} to={to} timeZone={timeZone} />}
    </section>
  );
}

function Report({ from, to, timeZone }: { from: string; to: string; timeZone: string }) {
  const revenue = useQuery({
    queryKey: [...REVENUE_KEY, from, to],
    queryFn: () => api.revenue({ from, to }),
  });
  const journal = useQuery({
    queryKey: [...REVENUE_KEY, 'journal', from, to],
    queryFn: () => api.paymentsJournal({ from, to }),
  });

  if (revenue.isPending) return <Loading />;
  if (revenue.isError) return <Alert>{errorMessage(revenue.error)}</Alert>;
  const r = revenue.data;
  const money = (cents: number) => formatCents(cents, r.currency);
  const period =
    from === to
      ? `le ${formatLocalDate(from)}`
      : `du ${formatLocalDate(from)} au ${formatLocalDate(to)}`;

  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Encaissé {period}</dt>
          <dd className="text-2xl font-semibold text-emerald-900">{money(r.totalCents)}</dd>
          <dd className="text-sm text-slate-600">
            {r.paymentsCount} paiement{r.paymentsCount > 1 ? 's' : ''}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Restant dû (tout le cabinet, à ce jour)</dt>
          <dd className="text-2xl font-semibold text-amber-800">{money(r.remainingCents)}</dd>
          <dd className="text-sm">
            <Link className="underline" to="/encaissements">
              Voir les patients concernés
            </Link>
          </dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <dt className="text-sm text-slate-600">Paiements annulés (non comptés)</dt>
          <dd className="text-2xl font-semibold text-slate-700">{money(r.voided.amountCents)}</dd>
          <dd className="text-sm text-slate-600">
            {r.voided.count} paiement{r.voided.count > 1 ? 's' : ''}
          </dd>
        </div>
      </dl>
      {r.paymentsCount > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Breakdown
            title="Par moyen de paiement"
            rows={r.byMethod.map((b) => ({
              key: b.method,
              label: PAYMENT_METHOD_LABELS[b.method],
              ...b,
            }))}
            money={money}
          />
          <Breakdown
            title="Par praticien"
            rows={r.byPractitioner.map((b) => ({
              key: b.practitionerId ?? 'aucun',
              label: b.displayName ?? 'Non précisé',
              ...b,
            }))}
            money={money}
          />
          <Breakdown
            title="Par jour"
            rows={r.byDay.map((b) => ({ key: b.date, label: formatLocalDate(b.date), ...b }))}
            money={money}
          />
        </div>
      )}
      <Journal query={journal} timeZone={timeZone} money={money} />
    </>
  );
}

function Breakdown({
  title,
  rows,
  money,
}: {
  title: string;
  rows: { key: string; label: string; amountCents: number; count: number }[];
  money: (cents: number) => string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Libellé</th>
            <th scope="col">Montant</th>
            <th scope="col">Paiements</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-slate-100 last:border-0">
              <th scope="row" className="py-1 text-left font-normal">
                {row.label}
              </th>
              <td className="py-1 text-right font-medium">{money(row.amountCents)}</td>
              <td className="py-1 pl-2 text-right text-slate-600">{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Journal({
  query,
  timeZone,
  money,
}: {
  query: UseQueryResult<PaymentsJournalResponse['payments']>;
  timeZone: string;
  money: (cents: number) => string;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Journal des encaissements</h2>
      {query.isPending && <Loading />}
      {query.isError && <Alert>{errorMessage(query.error)}</Alert>}
      {query.data?.length === 0 && (
        <p className="text-sm text-slate-600">Aucun paiement sur la période.</p>
      )}
      {query.data && query.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th scope="col" className="py-2 pr-2 font-medium">
                  Date
                </th>
                <th scope="col" className="py-2 pr-2 font-medium">
                  Patient
                </th>
                <th scope="col" className="py-2 pr-2 font-medium">
                  Acte
                </th>
                <th scope="col" className="py-2 pr-2 font-medium">
                  Moyen
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Montant
                </th>
              </tr>
            </thead>
            <tbody>
              {query.data.map((p) => {
                const voided = p.status === 'VOIDED';
                return (
                  <tr key={p.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {formatLocalDate(localDateOf(p.receivedAt, timeZone))}{' '}
                      {formatTime(p.receivedAt, timeZone)}
                    </td>
                    <td className="py-2 pr-2">
                      <Link className="underline" to={`/patients/${p.patient.id}#paiements`}>
                        {p.patient.lastName.toUpperCase()} {p.patient.firstName}
                      </Link>
                    </td>
                    <td className="py-2 pr-2">{p.chargeLabel}</td>
                    <td className="py-2 pr-2">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.reference ? ` · réf. ${p.reference}` : ''}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <span className={voided ? 'text-slate-500 line-through' : 'font-medium'}>
                        {money(p.amountCents)}
                      </span>
                      {voided && (
                        <span className="ml-2">
                          <Badge>Annulé</Badge>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {query.data && query.data.length >= MAX_JOURNAL_PAYMENTS && (
        <Alert tone="info">
          Seuls les {query.data.length} paiements les plus récents sont affichés ; les totaux
          ci-dessus portent sur toute la période.
        </Alert>
      )}
    </section>
  );
}
