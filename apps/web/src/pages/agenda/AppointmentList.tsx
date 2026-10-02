import type { Appointment, AppointmentStatus, Practitioner } from '@dental/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui';
import { ApiError, api, errorMessage } from '../../lib/api';
import { formatTime, localDateOf } from '../../lib/dates';
import { APPOINTMENT_STATUS_LABELS, STATUS_TONES } from './labels';
import { refreshAgenda } from './refresh';

/** Prochain rendez-vous « prévu » non terminé : en cours, ou le suivant. */
export function nextAppointment(list: readonly Appointment[], now: number): Appointment | null {
  return (
    [...list]
      .filter((a) => a.status === 'SCHEDULED' && Date.parse(a.endAt) > now)
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0] ?? null
  );
}

/**
 * Liste de rendez-vous d'une journée, pensée pour la tablette et le téléphone : heure, patient,
 * type, statut, et les gestes du quotidien. « Honoré » et « Patient absent » n'apparaissent
 * qu'une fois l'heure de début passée (le serveur applique la même règle).
 */
export function AppointmentList({
  appointments,
  practitioners,
  timeZone,
  now,
  canWrite,
  showPractitioner,
  label,
}: {
  appointments: readonly Appointment[];
  practitioners: readonly Practitioner[];
  timeZone: string;
  now: number;
  canWrite: boolean;
  showPractitioner: boolean;
  label: string;
}) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const change = useMutation({
    mutationFn: ({ a, status }: { a: Appointment; status: AppointmentStatus }) =>
      api.changeAppointmentStatus(a.id, { version: a.version, status, reason: null }),
    onMutate: () => setFailure(null),
    onSuccess: (updated) => refreshAgenda(queryClient, updated),
    onError: (error, { a }) =>
      setFailure({
        id: a.id,
        message:
          error instanceof ApiError && error.code === 'CONFLICT'
            ? 'Ce rendez-vous vient d’être modifié : la liste est rechargée.'
            : errorMessage(error),
      }),
    onSettled: (_data, error) => {
      if (error) void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
  const sorted = [...appointments].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const next = nextAppointment(sorted, now);

  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-slate-200">
      {sorted.map((a) => {
        const time = `${formatTime(a.startAt, timeZone)}–${formatTime(a.endAt, timeZone)}`;
        const name = `${a.patient.lastName.toUpperCase()} ${a.patient.firstName}`;
        const started = now >= Date.parse(a.startAt);
        const practitioner = practitioners.find((p) => p.id === a.practitionerId);
        const isNext = next?.id === a.id;
        return (
          <li
            key={a.id}
            className={`flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${
              isNext ? 'bg-sky-50' : ''
            } ${a.status === 'CANCELLED' ? 'text-slate-500' : ''}`}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold tabular-nums">{time}</span>
                <Link className="font-medium underline" to={`/patients/${a.patient.id}`}>
                  {name}
                </Link>
                {isNext && (
                  <Badge tone="info">{started ? 'En cours' : 'Prochain rendez-vous'}</Badge>
                )}
                {a.status !== 'SCHEDULED' && (
                  <Badge tone={STATUS_TONES[a.status]}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
                )}
              </p>
              <p className="text-sm text-slate-600">
                {a.appointmentType.name}
                {showPractitioner && practitioner ? ` · ${practitioner.displayName}` : ''}
              </p>
              {failure?.id === a.id && (
                <p role="alert" className="text-sm text-red-700">
                  {failure.message}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canWrite && a.status === 'SCHEDULED' && started && (
                <>
                  <button
                    type="button"
                    className="min-h-11 rounded-md px-3 text-sm font-medium ring-1 ring-emerald-400 hover:bg-emerald-50 disabled:text-slate-400"
                    aria-label={`Marquer honoré : ${time} ${name}`}
                    disabled={change.isPending}
                    onClick={() => change.mutate({ a, status: 'COMPLETED' })}
                  >
                    Honoré
                  </button>
                  <button
                    type="button"
                    className="min-h-11 rounded-md px-3 text-sm font-medium ring-1 ring-amber-400 hover:bg-amber-50 disabled:text-slate-400"
                    aria-label={`Marquer patient absent : ${time} ${name}`}
                    disabled={change.isPending}
                    onClick={() => change.mutate({ a, status: 'NO_SHOW' })}
                  >
                    Absent
                  </button>
                </>
              )}
              <Link
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium ring-1 ring-slate-300 hover:bg-slate-50"
                to={`/agenda?date=${localDateOf(a.startAt, timeZone)}&rdv=${a.id}`}
                aria-label={`Ouvrir le rendez-vous : ${time} ${name}`}
              >
                Ouvrir
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
