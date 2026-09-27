import type { PatientDetail } from '@dental/shared';
import { Link } from 'react-router';
import { ageOn, formatDayLabel, formatTime, localDateOf, todayIn } from '../../lib/dates';
import { formatDate } from '../../lib/format-date';
import { formatPhone } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { useAllPractitioners, useClinic } from '../../lib/queries';
import { upcomingOf, usePatientAppointments } from './PatientAppointments';

/**
 * Résumé en tête de fiche (ADR 0008) : de quoi répondre au téléphone ou accueillir le patient
 * sans faire défiler la page.
 */
export function PatientSummary({
  patient,
  readsAgenda,
}: {
  patient: PatientDetail;
  readsAgenda: boolean;
}) {
  const clinic = useClinic();
  const now = useNow();
  const timeZone = clinic.data?.timezone ?? 'UTC';
  const primary = patient.contacts.find((c) => c.isPrimary) ?? patient.contacts[0];

  return (
    <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm sm:grid-cols-3">
      <div>
        <dt className="font-medium text-slate-600">Téléphone</dt>
        <dd>
          {primary ? (
            <a
              className="text-base font-medium text-sky-800 underline"
              href={`tel:${primary.phone}`}
            >
              {formatPhone(primary.phone)}
            </a>
          ) : (
            'Aucun numéro'
          )}
        </dd>
      </div>
      <div>
        <dt className="font-medium text-slate-600">Naissance</dt>
        <dd>
          {patient.birthDate
            ? `${formatDate(patient.birthDate)}${
                clinic.data
                  ? ` (${ageOn(patient.birthDate, todayIn(timeZone, new Date(now)))} ans)`
                  : ''
              }`
            : 'Non renseignée'}
        </dd>
      </div>
      {readsAgenda && <NextAppointment patientId={patient.id} timeZone={timeZone} now={now} />}
    </dl>
  );
}

function NextAppointment({
  patientId,
  timeZone,
  now,
}: {
  patientId: string;
  timeZone: string;
  now: number;
}) {
  const appointments = usePatientAppointments(patientId);
  const practitioners = useAllPractitioners();
  const next = appointments.data ? (upcomingOf(appointments.data, now)[0] ?? null) : undefined;
  const practitioner = practitioners.data?.find((p) => p.id === next?.practitionerId);
  return (
    <div>
      <dt className="font-medium text-slate-600">Prochain rendez-vous</dt>
      <dd>
        {next === undefined
          ? '…'
          : next === null
            ? 'Aucun'
            : (() => {
                const day = localDateOf(next.startAt, timeZone);
                return (
                  <Link className="underline" to={`/agenda?date=${day}&rdv=${next.id}`}>
                    <span className="inline-block first-letter:uppercase">
                      {formatDayLabel(day)}
                    </span>{' '}
                    à {formatTime(next.startAt, timeZone)}
                    {practitioner ? ` · ${practitioner.displayName}` : ''}
                  </Link>
                );
              })()}
      </dd>
    </div>
  );
}
