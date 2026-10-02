import type { Appointment, AppointmentType, PatientSummary, Practitioner } from '@dental/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Loading, SelectField, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import { PHONE_QUERY, useMediaQuery, useNow } from '../../lib/hooks';
import {
  addDays,
  formatDayLabel,
  formatMinutes,
  localDateOf,
  localDateTimeOf,
  startOfWeek,
  todayIn,
} from '../../lib/dates';
import { useAllAppointmentTypes, useAllPractitioners, useClinic } from '../../lib/queries';
import { ColorSwatch } from '../settings/colors';
import { AgendaGrid, type AgendaColumn } from './AgendaGrid';
import { AppointmentDetails } from './AppointmentDetails';
import { AppointmentList } from './AppointmentList';
import { refreshAgenda } from './refresh';
import { AppointmentForm, type CreateDefaults } from './AppointmentForm';

type View = 'day' | 'week';
/** Création : praticien et date absents (lien direct) = ceux affichés par l'agenda. */
interface CreateRequest {
  practitionerId: string | null;
  date: string | null;
  time: string;
  patientId: string | null;
}
type Panel = { kind: 'view'; id: string } | ({ kind: 'create' } & CreateRequest) | null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string | null) =>
  value && DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : null;

/**
 * Agenda du cabinet, en heure du cabinet : vue « jour » (une colonne par praticien) ou
 * « semaine » (un praticien). Vue, date et praticien sont dans l'adresse (lien partageable).
 */
export function AgendaPage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const clinic = useClinic();
  const practitioners = useAllPractitioners();
  const types = useAllAppointmentTypes();
  const phone = useMediaQuery(PHONE_QUERY);
  // Liens directs : ?rdv=<id> ouvre un rendez-vous ; ?nouveau=1&patient=<id> en prépare un.
  const [panel, setPanel] = useState<Panel>(() => {
    const id = params.get('rdv');
    if (id) return { kind: 'view', id };
    if (params.get('nouveau') === '1') {
      return {
        kind: 'create',
        practitionerId: null,
        date: null,
        time: '09:00',
        patientId: params.get('patient'),
      };
    }
    return null;
  });
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const now = useNow();

  const timeZone = clinic.data?.timezone ?? 'UTC';
  const today = todayIn(timeZone);
  const date = validDate(params.get('date')) ?? today;
  const all = practitioners.data ?? [];
  const active = all.filter((p) => p.status === 'ACTIVE');
  const own = active.find((p) => p.userId === me?.user.id);
  // Vue par défaut (ADR 0008) : sa semaine pour un compte lié à un praticien, sinon la
  // journée de tout le cabinet.
  const requested = params.get('vue');
  const view: View =
    requested === 'semaine' ? 'week' : requested === 'jour' ? 'day' : own ? 'week' : 'day';
  const weekPractitioner =
    all.find((p) => p.id === params.get('praticien')) ?? own ?? active[0] ?? null;
  const from = view === 'day' ? date : startOfWeek(date);
  const to = view === 'day' ? date : addDays(from, 6);
  const practitionerFilter = view === 'week' ? weekPractitioner?.id : undefined;
  const ready = Boolean(clinic.data && practitioners.data && (view === 'day' || weekPractitioner));

  const appointments = useQuery({
    queryKey: ['appointments', from, to, practitionerFilter ?? 'all', includeCancelled],
    queryFn: () =>
      api.listAppointments({ from, to, practitionerId: practitionerFilter, includeCancelled }),
    enabled: ready,
  });
  const availability = useQuery({
    queryKey: ['availability', 'agenda', from, to, practitionerFilter ?? 'all'],
    queryFn: () => api.availability({ from, to, practitionerId: practitionerFilter }),
    enabled: ready,
  });

  // Adresse la plus récente, y compris un changement pas encore rendu : deux changements
  // rapprochés (vue puis date) s'enchaînent au lieu que le second efface le premier. La forme
  // fonctionnelle de setParams ne suffit pas : elle reçoit l'adresse du dernier rendu.
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(latest.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    latest.current = next;
    setParams(next, { replace: true });
  };
  const open = (next: Panel) => {
    setNotice(null);
    setPanel(next);
    // Les liens directs ne servent qu'à l'ouverture.
    if (params.has('rdv') || params.has('nouveau') || params.has('patient')) {
      update({ rdv: null, nouveau: null, patient: null });
    }
  };
  const canWrite = can(me, 'appointment.write');
  const defaultPractitionerId = (view === 'week' ? weekPractitioner : (own ?? active[0]))?.id;

  if (clinic.isPending || practitioners.isPending || types.isPending) return <Loading />;
  if (clinic.isError) return <Alert>{errorMessage(clinic.error)}</Alert>;
  if (practitioners.isError) return <Alert>{errorMessage(practitioners.error)}</Alert>;
  if (types.isError) return <Alert>{errorMessage(types.error)}</Alert>;

  if (active.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <Alert tone="info">
          Aucun praticien n&apos;est encore enregistré.{' '}
          {can(me, 'clinic.settings.manage') ? (
            <Link className="underline" to="/cabinet/praticiens">
              Ajouter un praticien
            </Link>
          ) : (
            "Demandez à l'administrateur du cabinet de les ajouter."
          )}
        </Alert>
      </section>
    );
  }

  const step = view === 'day' ? 1 : 7;
  const title =
    view === 'day'
      ? `${formatDayLabel(date)} ${date.slice(0, 4)}`
      : `Semaine du ${formatDayLabel(from)} ${from.slice(0, 4)}`;
  const nowMinutes = localDateTimeOf(now, timeZone).minutes;
  const noTypes = !types.data.some((t) => t.status === 'ACTIVE');

  // Vue jour : praticiens actifs, plus un praticien archivé qui a des rendez-vous ce jour-là.
  const dayPractitioners: Practitioner[] = all.filter(
    (p) =>
      p.status === 'ACTIVE' || appointments.data?.some((a) => a.practitionerId === p.id) === true,
  );
  // Téléphone : un praticien à la fois en vue jour (celui choisi, sinon le sien).
  const shownPractitioners =
    phone && dayPractitioners.length > 1
      ? dayPractitioners.filter((p) => p.id === weekPractitioner?.id)
      : dayPractitioners;
  const columns: AgendaColumn[] =
    view === 'day'
      ? shownPractitioners.map((p) => ({
          key: p.id,
          day: date,
          practitionerId: p.id,
          header: (
            <span className="flex items-center gap-2">
              <ColorSwatch color={p.color} /> {p.displayName}
            </span>
          ),
          srContext: p.displayName,
          isToday: date === today,
        }))
      : Array.from({ length: 7 }, (_, i) => {
          const day = addDays(from, i);
          const label = formatDayLabel(day);
          return {
            key: day,
            day,
            practitionerId: weekPractitioner!.id,
            header: <span className="block first-letter:uppercase">{label}</span>,
            srContext: label,
            isToday: day === today,
          };
        });

  const onSaved = async (appointment: Appointment, message: string) => {
    await refreshAgenda(queryClient, appointment);
    setPanel({ kind: 'view', id: appointment.id });
    setNotice(message);
    const day = localDateOf(appointment.startAt, timeZone);
    if (day < from || day > to) update({ date: day });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        {canWrite && (
          <Button
            disabled={noTypes}
            onClick={() =>
              open({
                kind: 'create',
                practitionerId: null,
                date: null,
                time: '09:00',
                patientId: null,
              })
            }
          >
            Nouveau rendez-vous
          </Button>
        )}
      </div>
      {canWrite && noTypes && (
        <Alert tone="info">
          Aucun type de rendez-vous actif : l&apos;administrateur doit en créer un (Cabinet, Types
          de rendez-vous).
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Vue" className="flex gap-1">
          {(
            [
              ['day', 'Jour'],
              ['week', 'Semaine'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => update({ vue: v === 'week' ? 'semaine' : 'jour' })}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 aria-pressed:bg-sky-100 aria-pressed:text-sky-900"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => update({ date: addDays(date, -step) })}>
            {view === 'day' ? 'Jour précédent' : 'Semaine précédente'}
          </Button>
          <Button
            variant="secondary"
            disabled={view === 'day' ? date === today : from === startOfWeek(today)}
            onClick={() => update({ date: null })}
          >
            Aujourd&apos;hui
          </Button>
          <Button variant="secondary" onClick={() => update({ date: addDays(date, step) })}>
            {view === 'day' ? 'Jour suivant' : 'Semaine suivante'}
          </Button>
        </div>
        <div className="w-44">
          <TextField
            label="Aller au"
            type="date"
            value={date}
            onChange={(e) => validDate(e.target.value) && update({ date: e.target.value })}
          />
        </div>
        {(view === 'week' || phone) && active.length > 1 && (
          <div className="min-w-56">
            <SelectField
              label="Agenda de"
              value={weekPractitioner?.id ?? ''}
              onChange={(e) => update({ praticien: e.target.value })}
            >
              {all
                .filter((p) => p.status === 'ACTIVE' || p.id === weekPractitioner?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                    {p.id === own?.id ? ' (moi)' : ''}
                  </option>
                ))}
            </SelectField>
          </div>
        )}
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={includeCancelled}
            onChange={(e) => setIncludeCancelled(e.target.checked)}
          />
          Afficher les annulés
        </label>
      </div>

      <h2 className="text-lg font-semibold first-letter:uppercase">{title}</h2>
      <div className={`grid gap-4 ${panel ? 'lg:grid-cols-[minmax(0,1fr)_24rem]' : 'grid-cols-1'}`}>
        <div className="min-w-0">
          {(appointments.isPending || availability.isPending) && <Loading />}
          {appointments.isError && <Alert>{errorMessage(appointments.error)}</Alert>}
          {availability.isError && <Alert>{errorMessage(availability.error)}</Alert>}
          {appointments.data &&
            availability.data &&
            (phone && view === 'week' ? (
              <WeekList
                days={columns.map((c) => c.day)}
                appointments={appointments.data}
                practitioners={all}
                timeZone={timeZone}
                now={now}
                canWrite={canWrite}
              />
            ) : (
              <>
                <AgendaGrid
                  columns={columns}
                  appointments={appointments.data}
                  availability={availability.data}
                  timeZone={timeZone}
                  nowMinutes={nowMinutes}
                  onSelect={(id) => open({ kind: 'view', id })}
                  onSlot={
                    canWrite && !noTypes
                      ? (column, minute) =>
                          open({
                            kind: 'create',
                            practitionerId: column.practitionerId,
                            date: column.day,
                            time: formatMinutes(minute),
                            patientId: null,
                          })
                      : null
                  }
                />
                <p className="mt-1 text-xs text-slate-600">
                  Heures du cabinet ({timeZone}). En blanc : horaires de travail ; hachuré :
                  absences et créneaux bloqués.
                </p>
              </>
            ))}
        </div>
        {panel && (
          <SidePanel
            title={panel.kind === 'view' ? 'Rendez-vous' : 'Nouveau rendez-vous'}
            onClose={() => open(null)}
          >
            {notice && <Alert tone="success">{notice}</Alert>}
            {panel.kind === 'view' ? (
              <AppointmentDetails
                key={panel.id}
                id={panel.id}
                practitioners={all}
                types={types.data}
                timeZone={timeZone}
                canWrite={canWrite}
                canCharge={can(me, 'payment.write')}
                onSaved={(a) => void onSaved(a, 'Rendez-vous modifié.')}
              />
            ) : canWrite ? (
              <CreatePanel
                key={`${panel.practitionerId}-${panel.date}-${panel.time}`}
                defaults={{
                  practitionerId: panel.practitionerId ?? defaultPractitionerId ?? '',
                  date: panel.date ?? date,
                  time: panel.time,
                }}
                patientId={panel.patientId}
                canCreatePatient={can(me, 'patient.write')}
                practitioners={all}
                types={types.data}
                timeZone={timeZone}
                onCancel={() => open(null)}
                onSaved={(a) => void onSaved(a, 'Rendez-vous enregistré.')}
              />
            ) : (
              <Alert>Vous ne pouvez pas créer de rendez-vous.</Alert>
            )}
          </SidePanel>
        )}
      </div>
    </section>
  );
}

function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Élément qui a ouvert le panneau, lu au premier rendu : avant que le titre ne prenne le
  // focus. À la fermeture, le focus lui revient (clavier et lecteur d'écran).
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );
  // Focus sur le titre à l'ouverture : le lecteur d'écran annonce le panneau.
  useEffect(() => heading.current?.focus(), [title]);
  return (
    <aside
      aria-labelledby="agenda-panel-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      // Tablette et téléphone : plein écran, au-dessus de la grille ; ordinateur : colonne.
      className="fixed inset-0 z-30 flex flex-col gap-3 overflow-y-auto bg-white p-4 lg:static lg:inset-auto lg:z-auto lg:self-start lg:rounded-lg lg:border lg:border-slate-200 lg:shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="agenda-panel-title" ref={heading} tabIndex={-1} className="text-lg font-semibold">
          {title}
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      </div>
      {children}
    </aside>
  );
}

/** Semaine sur téléphone : une liste par jour plutôt qu'une grille de sept colonnes. */
function WeekList({
  days,
  appointments,
  ...rest
}: {
  days: string[];
  appointments: Appointment[];
  practitioners: Practitioner[];
  timeZone: string;
  now: number;
  canWrite: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => {
        const items = appointments.filter((a) => localDateOf(a.startAt, rest.timeZone) === day);
        const label = formatDayLabel(day);
        return (
          <section
            key={day}
            aria-label={label}
            className="overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            <h3 className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold first-letter:uppercase">
              {label}
            </h3>
            {items.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-600">Aucun rendez-vous.</p>
            ) : (
              <AppointmentList
                appointments={items}
                showPractitioner={false}
                label={`Rendez-vous du ${label}`}
                {...rest}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Formulaire de création ; le patient d'un lien direct est chargé avant l'affichage. */
function CreatePanel({
  defaults,
  patientId,
  ...rest
}: {
  defaults: Omit<CreateDefaults, 'patient'>;
  patientId: string | null;
  canCreatePatient: boolean;
  practitioners: Practitioner[];
  types: AppointmentType[];
  timeZone: string;
  onCancel: () => void;
  onSaved: (a: Appointment) => void;
}) {
  const patient = useQuery({
    queryKey: ['patient', patientId],
    queryFn: () => api.getPatient(patientId ?? ''),
    enabled: patientId !== null,
  });
  if (patientId && patient.isPending) return <Loading />;
  if (patientId && patient.isError) return <Alert>{errorMessage(patient.error)}</Alert>;
  const preselected: PatientSummary | null =
    patient.data && patient.data.status === 'ACTIVE' ? patient.data : null;
  return (
    <AppointmentForm mode="create" defaults={{ ...defaults, patient: preselected }} {...rest} />
  );
}
