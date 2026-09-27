import type { Appointment } from '@dental/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Badge, Loading } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDayLabel, formatTime, localDateOf } from '../../lib/dates';
import { useNow } from '../../lib/hooks';
import { APPOINTMENT_STATUS_LABELS, STATUS_TONES } from '../agenda/labels';
import { useAllPractitioners, useClinic } from '../../lib/queries';

/** Rendez-vous d'un patient (historique complet, du plus récent au plus ancien). */
export const usePatientAppointments = (patientId: string, enabled = true) =>
  useQuery({
    queryKey: ['patient-appointments', patientId],
    queryFn: () => api.patientAppointments(patientId),
    enabled,
  });

/** Rendez-vous « prévus » non terminés, du plus proche au plus lointain. */
export function upcomingOf(list: readonly Appointment[], now: number): Appointment[] {
  return list
    .filter((a) => a.status === 'SCHEDULED' && new Date(a.endAt).getTime() > now)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}

/** Rendez-vous du patient : à venir, puis historique (tous statuts), en heure du cabinet. */
export function PatientAppointments({ patientId }: { patientId: string }) {
  const clinic = useClinic();
  const practitioners = useAllPractitioners();
  const appointments = usePatientAppointments(patientId);

  const now = useNow();
  const list = appointments.data ?? [];
  const upcoming = upcomingOf(list, now);
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
