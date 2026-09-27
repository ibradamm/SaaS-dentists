import type { Appointment, Practitioner } from '@dental/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Loading } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import { formatDayLabel, todayIn } from '../../lib/dates';
import { useNow } from '../../lib/hooks';
import { useAllPractitioners, useClinic } from '../../lib/queries';
import { AppointmentList } from '../agenda/AppointmentList';
import { ColorSwatch } from '../settings/colors';
import { SetupChecklist } from './SetupChecklist';

const actionLink =
  'inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700';

function counts(list: readonly Appointment[]) {
  const n = (status: Appointment['status']) => list.filter((a) => a.status === status).length;
  const parts = [`${list.length} rendez-vous`];
  if (n('COMPLETED') > 0) parts.push(`${n('COMPLETED')} honoré${n('COMPLETED') > 1 ? 's' : ''}`);
  if (n('NO_SHOW') > 0)
    parts.push(
      `${n('NO_SHOW')} patient${n('NO_SHOW') > 1 ? 's' : ''} absent${n('NO_SHOW') > 1 ? 's' : ''}`,
    );
  return parts.join(' · ');
}

/**
 * Accueil (ADR 0008) : la journée du praticien lié au compte (« Ma journée »), ou celle de tout
 * le cabinet, avec les gestes du quotidien ; l'administrateur voit aussi ce qui manque pour
 * que le cabinet fonctionne.
 */
export function TodayPage() {
  const { data: me } = useMe();
  const now = useNow();
  const readsAgenda = can(me, 'appointment.read');
  const clinic = useClinic();
  const practitioners = useAllPractitioners();
  const [scope, setScope] = useState<'mine' | 'all' | null>(null);

  const timeZone = clinic.data?.timezone ?? 'UTC';
  const today = todayIn(timeZone, new Date(now));
  const active = (practitioners.data ?? []).filter((p) => p.status === 'ACTIVE');
  const own = active.find((p) => p.userId === me?.user.id) ?? null;
  const effective = scope ?? (own ? 'mine' : 'all');
  const filter = effective === 'mine' && own ? own.id : undefined;
  const appointments = useQuery({
    queryKey: ['appointments', today, today, filter ?? 'all', false],
    queryFn: () => api.listAppointments({ from: today, to: today, practitionerId: filter }),
    enabled: readsAgenda && Boolean(clinic.data && practitioners.data),
  });

  const greeting = (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold">Bonjour {me?.user.fullName}</h1>
      {clinic.data && (
        <p className="text-slate-600 first-letter:uppercase">
          {formatDayLabel(today)} {today.slice(0, 4)}
        </p>
      )}
    </div>
  );
  if (!readsAgenda) return <section className="flex flex-col gap-4">{greeting}</section>;
  if (clinic.isPending || practitioners.isPending || clinic.isError || practitioners.isError) {
    return (
      <section className="flex flex-col gap-4">
        {greeting}
        {clinic.isError && <Alert>{errorMessage(clinic.error)}</Alert>}
        {practitioners.isError && <Alert>{errorMessage(practitioners.error)}</Alert>}
        {(clinic.isPending || practitioners.isPending) && <Loading />}
      </section>
    );
  }

  const canWrite = can(me, 'appointment.write');
  const list = appointments.data ?? [];
  const groups: { practitioner: Practitioner; items: Appointment[] }[] =
    effective === 'mine' && own
      ? [{ practitioner: own, items: list }]
      : active
          .map((p) => ({ practitioner: p, items: list.filter((a) => a.practitionerId === p.id) }))
          .filter((g) => g.items.length > 0 || active.length <= 3);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {greeting}
        <div className="flex flex-wrap gap-2">
          {canWrite && active.length > 0 && (
            <Link
              to="/agenda?nouveau=1"
              className={`${actionLink} bg-sky-700 text-white hover:bg-sky-800`}
            >
              Nouveau rendez-vous
            </Link>
          )}
          {can(me, 'patient.write') && (
            <Link
              to="/patients/nouveau"
              className={`${actionLink} bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50`}
            >
              Nouveau patient
            </Link>
          )}
        </div>
      </div>

      {can(me, 'clinic.settings.manage') && <SetupChecklist today={today} />}

      {active.length === 0 ? (
        !can(me, 'clinic.settings.manage') && (
          <Alert tone="info">
            Aucun praticien n&apos;est encore enregistré : demandez à l&apos;administrateur du
            cabinet de les ajouter.
          </Alert>
        )
      ) : (
        <section aria-labelledby="journee" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 id="journee" className="text-lg font-semibold">
                {effective === 'mine' ? 'Ma journée' : "Aujourd'hui au cabinet"}
              </h2>
              {appointments.data && <p className="text-sm text-slate-600">{counts(list)}</p>}
            </div>
            {own && active.length > 1 && (
              <div role="group" aria-label="Rendez-vous affichés" className="flex gap-1">
                {(
                  [
                    ['mine', 'Mes rendez-vous'],
                    ['all', 'Tout le cabinet'],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={effective === value}
                    onClick={() => setScope(value)}
                    className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 aria-pressed:bg-sky-100 aria-pressed:text-sky-900"
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </div>
          {appointments.isPending && <Loading />}
          {appointments.isError && <Alert>{errorMessage(appointments.error)}</Alert>}
          {appointments.data &&
            (list.length === 0 ? (
              <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-600">
                Aucun rendez-vous aujourd&apos;hui.
              </p>
            ) : (
              groups.map(({ practitioner, items }) => (
                <div
                  key={practitioner.id}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-white"
                >
                  {groups.length > 1 && (
                    <h3 className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold">
                      <ColorSwatch color={practitioner.color} /> {practitioner.displayName}
                    </h3>
                  )}
                  {items.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-slate-600">Aucun rendez-vous.</p>
                  ) : (
                    <AppointmentList
                      appointments={items}
                      practitioners={practitioners.data}
                      timeZone={timeZone}
                      now={now}
                      canWrite={canWrite}
                      showPractitioner={false}
                      label={`Rendez-vous du jour : ${practitioner.displayName}`}
                    />
                  )}
                </div>
              ))
            ))}
          <p className="text-xs text-slate-600">
            Heures du cabinet ({timeZone}).{' '}
            <Link className="underline" to="/agenda">
              Ouvrir l&apos;agenda
            </Link>
          </p>
        </section>
      )}
    </section>
  );
}
