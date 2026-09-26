import type { Appointment } from '@dental/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Badge, Loading } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDayLabel, formatTime, localDateOf } from '../../lib/dates';
import { useNow } from '../../lib/hooks';
import { APPOINTMENT_STATUS_LABELS, STATUS_TONES } from '../agenda/labels';
import { CLINIC_QUERY_KEY } from '../settings/ClinicProfilePage';
import { PRACTITIONERS_KEY } from '../settings/PractitionersPage';

const linkButton =
  'inline-flex min-h-11 items-center rounded-md bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700';

/** Rendez-vous du patient : à venir, puis historique (tous statuts), en heure du cabinet. */
export function PatientAppointments({
  patientId,
  canBook,
}: {
  patientId: string;
  canBook: boolean;
}) {
  const clinic = useQuery({ queryKey: CLINIC_QUERY_KEY, queryFn: api.clinic });
  const practitioners = useQuery({
    queryKey: [...PRACTITIONERS_KEY, 'all'],
    queryFn: () => api.listPractitioners(true),
  });
  const appointments = useQuery({
    queryKey: ['patient-appointments', patientId],
    queryFn: () => api.patientAppointments(patientId),
  });

  const now = useNow();
  const list = appointments.data ?? [];
  // Réponse du plus récent au plus ancien : les rendez-vous à venir sont remis dans l'ordre.
  const upcoming = list
    .filter((a) => a.status === 'SCHEDULED' && new Date(a.endAt).getTime() > now)
    .reverse();
  const past = list.filter((a) => !upcoming.includes(a));

  const item = (a: Appointment, timeZone: string) => {
    const day = localDateOf(a.startAt, timeZone);
    const practitioner = practitioners.data?.find((p) => p.id === a.practitionerId);
    return (
      <li
        key={a.id}
        className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2 text-sm"
      >
        <Link className="font-medium underline" to={`/agenda?date=${day}&rdv=${a.id}`}>
          <span className="inline-block first-letter:uppercase">{formatDayLabel(day)}</span>{' '}
          {day.slice(0, 4)} à {formatTime(a.startAt, timeZone)}
        </Link>
        <span className="text-slate-700">
          {a.appointmentType.name}
          {practitioner ? ` · ${practitioner.displayName}` : ''}
        </span>
        <Badge tone={STATUS_TONES[a.status]}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
      </li>
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Rendez-vous</h2>
        {canBook && (
          <Link className={linkButton} to={`/agenda?nouveau=1&patient=${patientId}`}>
            Prendre rendez-vous
          </Link>
        )}
      </div>
      {(appointments.isPending || clinic.isPending) && <Loading />}
      {appointments.isError && <Alert>{errorMessage(appointments.error)}</Alert>}
      {clinic.isError && <Alert>{errorMessage(clinic.error)}</Alert>}
      {appointments.data && clinic.data && (
        <>
          <h3 className="text-sm font-semibold text-slate-800">À venir</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-600">Aucun rendez-vous à venir.</p>
          ) : (
            <ul aria-label="Rendez-vous à venir">
              {upcoming.map((a) => item(a, clinic.data.timezone))}
            </ul>
          )}
          <h3 className="text-sm font-semibold text-slate-800">Historique</h3>
          {past.length === 0 ? (
            <p className="text-sm text-slate-600">Aucun rendez-vous passé ou annulé.</p>
          ) : (
            <ul aria-label="Historique des rendez-vous">
              {past.map((a) => item(a, clinic.data.timezone))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
