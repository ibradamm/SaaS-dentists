import {
  PERIOD_KINDS,
  formatCents,
  periodError,
  periodOf,
  shiftPeriod,
  type DashboardResponse,
  type Period,
  type PeriodKind,
} from '@dental/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Loading, SelectField, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import { formatDayLabel, formatTime, localDateOf, todayIn } from '../../lib/dates';
import { useNow } from '../../lib/hooks';
import { DASHBOARD_KEY, useAllPractitioners, useClinic, useDashboard } from '../../lib/queries';
import { BarList, ColumnChart, Meter, SERIES, type Bucket } from './charts';
import {
  bucketLabel,
  formatChange,
  formatCount,
  formatDuration,
  formatPeriod,
  formatRate,
  plural,
  tickLabel,
} from './format';

const KIND_LABELS: Record<PeriodKind | 'custom', string> = {
  day: 'Aujourd’hui',
  week: 'Semaine',
  month: 'Mois',
  year: 'Année',
  custom: 'Période libre',
};

type Kind = PeriodKind | 'custom';
const isKind = (value: string | null): value is Kind =>
  value === 'custom' || (PERIOD_KINDS as readonly string[]).includes(value ?? '');

function Tile({
  label,
  value,
  detail,
  children,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4">
      <dt className="text-sm text-slate-600">{label}</dt>
      <dd className="text-2xl font-semibold text-slate-900">{value}</dd>
      {detail && <dd className="text-sm text-slate-600">{detail}</dd>}
      {/* Dans une liste de définitions, un groupe ne contient que des dt et des dd. */}
      {children && <dd>{children}</dd>}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      {children}
    </div>
  );
}

/** « Période précédente : 25,00 € (+12 %) ». */
function comparison(current: number, previous: number, format: (n: number) => string) {
  const change = formatChange(current, previous);
  return `Période précédente : ${format(previous)}${change ? ` (${change})` : ''}`;
}

/**
 * Statistiques (docs/adr/0010) : tout est calculé par le serveur ; chaque bloc n'apparaît que
 * si la réponse contient sa section, c'est-à-dire si le compte a la permission de ses données.
 */
export function StatsPage() {
  const clinic = useClinic();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const practitioners = useAllPractitioners();

  const today = clinic.data ? todayIn(clinic.data.timezone, new Date(now)) : null;
  const kindParam = params.get('vue');
  const kind: Kind = isKind(kindParam) ? kindParam : 'month';
  const fallback = today ? periodOf(kind === 'custom' ? 'month' : kind, today) : null;
  const period: Period | null = fallback && {
    from: params.get('du') ?? fallback.from,
    to: params.get('au') ?? fallback.to,
  };
  const practitionerId = params.get('praticien');
  const error = period ? periodError(period.from, period.to) : null;

  const update = (next: { kind?: Kind; period?: Period; practitionerId?: string | null }) => {
    const p = next.period ?? period!;
    const values: Record<string, string> = {
      vue: next.kind ?? kind,
      du: p.from,
      au: p.to,
    };
    const who = next.practitionerId === undefined ? practitionerId : next.practitionerId;
    if (who) values.praticien = who;
    setParams(values, { replace: true });
  };

  if (clinic.isPending) return <Loading />;
  if (clinic.isError) return <Alert>{errorMessage(clinic.error)}</Alert>;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Statistiques</h1>
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div role="group" aria-label="Période" className="flex flex-wrap gap-2">
            {(['day', 'week', 'month', 'year', 'custom'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() =>
                  update({
                    kind: k,
                    period: k === 'custom' ? period! : periodOf(k, today!),
                  })
                }
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-700 aria-pressed:bg-sky-100 aria-pressed:text-sky-900 aria-pressed:ring-sky-300"
              >
                {KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="min-w-48 flex-1 sm:max-w-64">
            <SelectField
              label="Praticien"
              value={practitionerId ?? ''}
              onChange={(e) => update({ practitionerId: e.target.value || null })}
            >
              <option value="">Tous les praticiens</option>
              {(practitioners.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                  {p.status === 'ARCHIVED' ? ' (archivé)' : ''}
                </option>
              ))}
            </SelectField>
          </div>
        </div>
        {kind === 'custom' ? (
          <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
            <TextField
              label="Du"
              type="date"
              value={period!.from}
              onChange={(e) => update({ period: { from: e.target.value, to: period!.to } })}
            />
            <TextField
              label="Au"
              type="date"
              value={period!.to}
              onChange={(e) => update({ period: { from: period!.from, to: e.target.value } })}
            />
          </div>
        ) : (
          !error && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Période précédente"
                onClick={() => update({ period: shiftPeriod(period!, -1) })}
                className="inline-flex size-11 items-center justify-center rounded-md ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-700"
              >
                <span aria-hidden>‹</span>
              </button>
              <p className="min-w-0 font-medium first-letter:uppercase" aria-live="polite">
                {formatPeriod(period!)}
              </p>
              <button
                type="button"
                aria-label="Période suivante"
                onClick={() => update({ period: shiftPeriod(period!, 1) })}
                className="inline-flex size-11 items-center justify-center rounded-md ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-sky-700"
              >
                <span aria-hidden>›</span>
              </button>
            </div>
          )
        )}
        {error && <Alert tone="warning">{error}</Alert>}
      </div>
      {!error && period && (
        <Dashboard
          period={period}
          practitionerId={practitionerId}
          timeZone={clinic.data.timezone}
        />
      )}
    </section>
  );
}

function Dashboard({
  period,
  practitionerId,
  timeZone,
}: {
  period: Period;
  practitionerId: string | null;
  timeZone: string;
}) {
  const { data: me } = useMe();
  const query = useDashboard(period.from, period.to, practitionerId);
  if (query.isPending) return <Loading />;
  if (query.isError) return <Alert>{errorMessage(query.error)}</Alert>;
  const d = query.data;
  const money = (cents: number) => formatCents(cents, d.currency);
  const label = (start: string) => bucketLabel(start, d.granularity, d);
  const previous = formatPeriod(d.previous);

  return (
    <div
      className={`flex flex-col gap-4 transition-opacity ${query.isPlaceholderData ? 'opacity-60' : ''}`}
      aria-busy={query.isPlaceholderData}
    >
      {practitionerId && (
        <p className="text-sm text-slate-600">
          Filtré sur un praticien : activité, occupation, revenus et actes manquants. Les patients
          et le restant à encaisser restent ceux de tout le cabinet.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {d.revenue && (
          <Tile
            label="Revenus encaissés"
            value={money(d.revenue.totalCents)}
            detail={comparison(d.revenue.totalCents, d.revenue.previousTotalCents, money)}
          />
        )}
        {d.activity && (
          <Tile
            label="Rendez-vous honorés"
            value={formatCount(d.activity.completed)}
            detail={`${formatCount(d.activity.total)} rendez-vous · ${comparison(d.activity.completed, d.activity.previousCompleted, formatCount)}`}
          />
        )}
        {d.activity && (
          <Tile
            label="Occupation du planning"
            value={formatRate(d.activity.occupancy.rate)}
            detail={`${formatDuration(d.activity.occupancy.bookedMinutes)} réservées sur ${formatDuration(d.activity.occupancy.openMinutes)} ouvertes`}
          >
            <Meter
              rate={d.activity.occupancy.rate}
              label={`Occupation du planning : ${formatRate(d.activity.occupancy.rate)}`}
            />
          </Tile>
        )}
        {d.receivables && (
          <Tile
            label="Restant à encaisser"
            value={money(d.receivables.totalRemainingCents)}
            detail={
              <Link className="underline" to="/encaissements">
                {formatCount(d.receivables.patients)} patient
                {d.receivables.patients > 1 ? 's' : ''} · aujourd’hui
              </Link>
            }
          />
        )}
        {d.activity && (
          <Tile
            label="Taux de présence"
            value={formatRate(d.activity.presenceRate)}
            detail={`Taux d’absence : ${formatRate(d.activity.noShowRate)} · ${plural(d.activity.completed, 'honoré')}, ${plural(d.activity.noShow, 'absent')}`}
          />
        )}
        {d.activity && (
          <Tile
            label="Rendez-vous annulés"
            value={formatCount(d.activity.cancelled)}
            detail={`Taux d’annulation : ${formatRate(d.activity.cancellationRate)}`}
          />
        )}
        {d.activity && (
          <Tile
            label="Patients vus"
            value={formatCount(d.activity.patientsSeen)}
            detail={`À venir (7 prochains jours) : ${formatCount(d.activity.upcomingNext7Days)}`}
          />
        )}
        {d.patients && (
          <Tile
            label="Nouveaux patients"
            value={formatCount(d.patients.new)}
            detail={`${formatCount(d.patients.active)} patients actifs · ${comparison(d.patients.new, d.patients.previousNew, formatCount)}`}
          />
        )}
      </dl>
      <p className="text-xs text-slate-600">
        Comparaisons avec la période précédente : {previous}. Heures et jours du cabinet ({timeZone}
        ).
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.revenue && (
          <Card>
            <ColumnChart
              title="Évolution des revenus encaissés"
              buckets={d.revenue.series.map((b): Bucket<'amount'> => ({
                start: b.start,
                label: label(b.start),
                tick: tickLabel(b.start, d.granularity),
                values: { amount: b.amountCents },
              }))}
              series={[{ key: 'amount', label: 'Encaissé', color: SERIES.blue }]}
              format={money}
              empty="Aucun encaissement sur la période."
            />
            {d.revenue.voided.count > 0 && (
              <p className="text-xs text-slate-600">
                Paiements annulés, non comptés : {money(d.revenue.voided.amountCents)} (
                {formatCount(d.revenue.voided.count)}).{' '}
                <Link className="underline" to={`/revenus?du=${d.from}&au=${d.to}`}>
                  Journal des encaissements
                </Link>
              </p>
            )}
          </Card>
        )}
        {d.activity && (
          <Card>
            <ColumnChart
              title="Activité par période"
              buckets={d.activity.series.map((b): Bucket<'completed' | 'noShow' | 'scheduled'> => ({
                start: b.start,
                label: label(b.start),
                tick: tickLabel(b.start, d.granularity),
                values: { completed: b.completed, noShow: b.noShow, scheduled: b.scheduled },
              }))}
              series={[
                { key: 'completed', label: 'Honorés', color: SERIES.blue },
                { key: 'noShow', label: 'Absents', color: SERIES.orange },
                { key: 'scheduled', label: 'Prévus', color: SERIES.aqua },
              ]}
              format={formatCount}
              empty="Aucun rendez-vous sur la période."
            />
          </Card>
        )}
        {d.activity && (
          <Card>
            <h3 className="font-semibold">Occupation du planning par praticien</h3>
            {d.activity.byPractitioner.length === 0 ? (
              <p className="text-sm text-slate-600">Aucun praticien.</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {d.activity.byPractitioner.map((p) => (
                  <li key={p.practitionerId} className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="font-medium">{p.displayName}</span>
                      <span className="tabular-nums">{formatRate(p.rate)}</span>
                    </div>
                    <Meter rate={p.rate} label={`${p.displayName} : ${formatRate(p.rate)}`} />
                    <span className="text-xs text-slate-600">
                      Présence {formatRate(p.presenceRate)} · {formatCount(p.completed)} honorés ·{' '}
                      {formatCount(p.noShow)} absents · {formatCount(p.cancelled)} annulés
                      {p.openMinutes === 0 ? ' · aucun horaire sur la période' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {d.revenue && (
          <Card>
            <BarList
              title="Revenus par praticien"
              rows={d.revenue.byPractitioner.map((p) => ({
                key: p.practitionerId ?? 'aucun',
                label: p.displayName ?? 'Non précisé',
                value: p.amountCents,
                display: money(p.amountCents),
              }))}
              empty="Aucun encaissement sur la période."
            />
          </Card>
        )}
        {d.activity && (
          <Card>
            <BarList
              title="Types de rendez-vous les plus fréquents"
              rows={d.activity.topTypes.map((x) => ({
                key: x.appointmentTypeId,
                label: x.name,
                value: x.count,
                display: `${formatCount(x.count)} (${formatRate(x.share)})`,
              }))}
              empty="Aucun rendez-vous sur la période."
            />
          </Card>
        )}
        {d.unbilled && (
          <Unbilled data={d.unbilled} timeZone={timeZone} canCharge={can(me, 'payment.write')} />
        )}
      </div>
    </div>
  );
}

function Unbilled({
  data,
  timeZone,
  canCharge,
}: {
  data: NonNullable<DashboardResponse['unbilled']>;
  timeZone: string;
  canCharge: boolean;
}) {
  const queryClient = useQueryClient();
  const exempt = useMutation({
    mutationFn: (appointmentId: string) => api.setBillingExempt(appointmentId, true),
    onSettled: () => queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY }),
  });
  return (
    <Card>
      <h3 className="font-semibold">Rendez-vous honorés sans acte saisi</h3>
      {exempt.isError && <Alert>{errorMessage(exempt.error)}</Alert>}
      <p className="text-sm text-slate-600">
        {data.count === 0
          ? 'Tous les rendez-vous honorés de la période ont un acte à encaisser.'
          : `${formatCount(data.count)} rendez-vous honoré${data.count > 1 ? 's' : ''} sans acte ouvert${data.count > data.items.length ? ` ; les ${data.items.length} plus récents :` : ' :'}`}
      </p>
      {data.items.length > 0 && (
        <ul
          aria-label="Rendez-vous honorés sans acte saisi"
          className="flex flex-col gap-1 text-sm"
        >
          {data.items.map((i) => {
            const day = localDateOf(i.startAt, timeZone);
            return (
              <li
                key={i.appointmentId}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1"
              >
                <span>
                  <span className="inline-block first-letter:uppercase">{formatDayLabel(day)}</span>{' '}
                  à {formatTime(i.startAt, timeZone)} · {i.patient.lastName.toUpperCase()}{' '}
                  {i.patient.firstName} · {i.appointmentTypeName}
                </span>
                {canCharge && (
                  <span className="flex flex-wrap gap-x-4">
                    <Link
                      className="inline-flex min-h-11 items-center underline"
                      to={`/patients/${i.patient.id}?encaisser=${i.appointmentId}#paiements`}
                    >
                      Encaisser
                    </Link>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center text-slate-700 underline disabled:text-slate-400"
                      aria-label={`Sans facturation : ${i.patient.lastName.toUpperCase()} ${i.patient.firstName}, ${formatDayLabel(day)}`}
                      disabled={exempt.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Marquer ce rendez-vous « sans facturation » (rendez-vous gratuit) ? La mention peut être retirée depuis l’agenda.',
                          )
                        )
                          exempt.mutate(i.appointmentId);
                      }}
                    >
                      Sans facturation
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {data.exempt > 0 && (
        <p className="text-xs text-slate-600">
          {formatCount(data.exempt)} rendez-vous honoré{data.exempt > 1 ? 's' : ''} marqué
          {data.exempt > 1 ? 's' : ''} « sans facturation », non compté{data.exempt > 1 ? 's' : ''}{' '}
          ici.
        </p>
      )}
    </Card>
  );
}
