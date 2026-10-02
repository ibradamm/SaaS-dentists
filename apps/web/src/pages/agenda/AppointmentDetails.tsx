import {
  APPOINTMENT_TRANSITIONS,
  type Appointment,
  type AppointmentStatus,
  type AppointmentType,
  type Practitioner,
} from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Loading, TextField } from '../../components/ui';
import { ApiError, api, errorMessage } from '../../lib/api';
import { formatDayLabel, formatTime, localDateOf } from '../../lib/dates';
import { formatPhone } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { AppointmentForm } from './AppointmentForm';
import { appointmentKey, refreshAgenda } from './refresh';
import { APPOINTMENT_STATUS_LABELS, STATUS_ACTION_LABELS, STATUS_TONES } from './labels';
import { DASHBOARD_KEY } from '../../lib/queries';

/** Fiche d'un rendez-vous : détails, changements de statut, modification. */
export function AppointmentDetails({
  id,
  practitioners,
  types,
  timeZone,
  canWrite,
  canCharge,
  onSaved,
}: {
  id: string;
  practitioners: Practitioner[];
  types: AppointmentType[];
  timeZone: string;
  canWrite: boolean;
  /** Saisie d'un acte à encaisser pour ce rendez-vous (`payment.write`, vérifiée par le serveur). */
  canCharge: boolean;
  onSaved: (appointment: Appointment) => void;
}) {
  const queryClient = useQueryClient();
  const appointment = useQuery({
    queryKey: appointmentKey(id),
    queryFn: () => api.getAppointment(id),
  });
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const now = useNow();

  const changeStatus = useMutation({
    mutationFn: ({ a, status }: { a: Appointment; status: AppointmentStatus }) =>
      api.changeAppointmentStatus(a.id, {
        version: a.version,
        status,
        reason: status === 'CANCELLED' ? reason.trim() || null : null,
      }),
    onSuccess: async (updated) => {
      setCancelling(false);
      setReason('');
      await refreshAgenda(queryClient, updated);
    },
  });

  // Mention « sans facturation » (rendez-vous gratuit) : ne compte pas comme oubli d'encaissement.
  const billing = useMutation({
    mutationFn: (billingExempt: boolean) => api.setBillingExempt(id, billingExempt),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appointmentKey(id) }),
        queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY }),
        queryClient.invalidateQueries({ queryKey: ['appointments'] }),
      ]);
    },
  });

  if (appointment.isPending) return <Loading />;
  if (appointment.isError) return <Alert>{errorMessage(appointment.error)}</Alert>;
  const a = appointment.data;
  const practitioner = practitioners.find((p) => p.id === a.practitionerId);
  const started = now >= new Date(a.startAt).getTime();
  const stale = changeStatus.error instanceof ApiError && changeStatus.error.code === 'CONFLICT';

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Modifier le rendez-vous</h3>
        <AppointmentForm
          key={a.version}
          mode="edit"
          appointment={a}
          practitioners={practitioners}
          types={types}
          timeZone={timeZone}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false);
            onSaved(updated);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="font-medium">Patient</dt>
        <dd>
          <Link className="underline" to={`/patients/${a.patient.id}`}>
            {a.patient.lastName.toUpperCase()} {a.patient.firstName}
          </Link>
          {a.patient.primaryPhone && (
            <span className="block text-slate-600">{formatPhone(a.patient.primaryPhone)}</span>
          )}
        </dd>
        <dt className="font-medium">Date</dt>
        <dd className="first-letter:uppercase">
          {formatDayLabel(localDateOf(a.startAt, timeZone))}
        </dd>
        <dt className="font-medium">Heure</dt>
        <dd>
          {formatTime(a.startAt, timeZone)}–{formatTime(a.endAt, timeZone)} ({a.durationMinutes}{' '}
          min)
        </dd>
        <dt className="font-medium">Praticien</dt>
        <dd>{practitioner?.displayName ?? '—'}</dd>
        <dt className="font-medium">Type</dt>
        <dd>{a.appointmentType.name}</dd>
        <dt className="font-medium">Statut</dt>
        <dd>
          <Badge tone={STATUS_TONES[a.status]}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
        </dd>
        {a.note && (
          <>
            <dt className="font-medium">Note</dt>
            <dd className="whitespace-pre-wrap">{a.note}</dd>
          </>
        )}
        {a.billingExempt && (
          <>
            <dt className="font-medium">Facturation</dt>
            <dd>
              <Badge>Sans facturation</Badge>
            </dd>
          </>
        )}
        {a.cancellationReason && (
          <>
            <dt className="font-medium">Motif d&apos;annulation</dt>
            <dd>{a.cancellationReason}</dd>
          </>
        )}
      </dl>

      {stale ? (
        <Alert>
          Ce rendez-vous vient d&apos;être modifié par quelqu&apos;un d&apos;autre.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => {
              changeStatus.reset();
              void appointment.refetch();
            }}
          >
            Recharger
          </button>
        </Alert>
      ) : (
        changeStatus.isError && <Alert>{errorMessage(changeStatus.error)}</Alert>
      )}

      {canWrite && cancelling && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 p-3">
          <TextField
            label="Motif d'annulation (facultatif)"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            hint="Par exemple « à la demande du patient ». Aucune information médicale."
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="danger"
              disabled={changeStatus.isPending}
              onClick={() => changeStatus.mutate({ a, status: 'CANCELLED' })}
            >
              Confirmer l&apos;annulation
            </Button>
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Retour
            </Button>
          </div>
        </div>
      )}

      {canWrite && !cancelling && (
        <div className="flex flex-wrap gap-2">
          {a.status === 'SCHEDULED' && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Modifier ou déplacer
            </Button>
          )}
          {APPOINTMENT_TRANSITIONS[a.status].map((t) => {
            const early = t.requiresStarted === true && !started;
            return (
              <Button
                key={t.to}
                variant={t.to === 'CANCELLED' ? 'danger' : 'secondary'}
                disabled={changeStatus.isPending || early}
                title={early ? 'Possible à partir de l’heure du rendez-vous' : undefined}
                onClick={() =>
                  t.to === 'CANCELLED'
                    ? setCancelling(true)
                    : changeStatus.mutate({ a, status: t.to })
                }
              >
                {STATUS_ACTION_LABELS[t.to]}
              </Button>
            );
          })}
        </div>
      )}
      {billing.isError && <Alert>{errorMessage(billing.error)}</Alert>}
      {canCharge && a.status !== 'CANCELLED' && (
        <div className="flex flex-wrap gap-2">
          {!a.billingExempt && (
            <Link
              className="inline-flex min-h-11 items-center rounded-md bg-white px-4 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
              to={`/patients/${a.patient.id}?encaisser=${a.id}#paiements`}
            >
              Encaisser
            </Link>
          )}
          <Button
            variant="secondary"
            disabled={billing.isPending}
            onClick={() => billing.mutate(!a.billingExempt)}
          >
            {a.billingExempt ? 'Rétablir la facturation' : 'Sans facturation'}
          </Button>
        </div>
      )}
      {canWrite && a.status === 'SCHEDULED' && !started && (
        <p className="text-xs text-slate-600">
          « Honoré » et « Patient absent » sont possibles à partir de l&apos;heure du rendez-vous.
        </p>
      )}
      {a.status === 'CANCELLED' && (
        <p className="text-xs text-slate-600">
          Un rendez-vous annulé ne se rétablit pas : créez-en un nouveau.
        </p>
      )}
    </div>
  );
}
