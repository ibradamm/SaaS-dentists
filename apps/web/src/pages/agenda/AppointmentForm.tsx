import {
  MAX_APPOINTMENT_MINUTES,
  MIN_APPOINTMENT_MINUTES,
  type Appointment,
  type OverrideReason,
  type AppointmentType,
  type PatientSummary,
  type Practitioner,
} from '@dental/shared';
import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Button, SelectField, TextArea, TextField } from '../../components/ui';
import { ApiError, api, errorMessage } from '../../lib/api';
import { formatTime, localDateTimeOf } from '../../lib/dates';
import { formatDate } from '../../lib/format-date';
import { formatPhone } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';
import { useIdempotencyKey } from '../../lib/idempotency';
import { OVERRIDE_REASON_LABELS } from './labels';
import { QuickPatientForm } from './QuickPatientForm';

export interface CreateDefaults {
  practitionerId: string;
  date: string;
  time: string;
  patient: PatientSummary | null;
}

interface Values {
  practitionerId: string;
  appointmentTypeId: string;
  date: string;
  time: string;
  duration: string;
  note: string;
}

type Props = {
  practitioners: Practitioner[];
  types: AppointmentType[];
  timeZone: string;
  /** Création d'un patient depuis le formulaire (permission `patient.write`). */
  canCreatePatient?: boolean;
  onSaved: (appointment: Appointment) => void;
  onCancel: () => void;
} & ({ mode: 'create'; defaults: CreateDefaults } | { mode: 'edit'; appointment: Appointment });

const patientLabel = (p: { lastName: string; firstName: string }) =>
  `${p.lastName.toUpperCase()} ${p.firstName}`;

function validDuration(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) &&
    n >= MIN_APPOINTMENT_MINUTES &&
    n <= MAX_APPOINTMENT_MINUTES &&
    n % 5 === 0
    ? n
    : null;
}

/**
 * Création ou modification d'un rendez-vous, saisi en heure locale du cabinet. Hors horaires ou
 * sur un créneau bloqué, le serveur exige une confirmation explicite : elle n'est jamais
 * envoyée d'office, seulement après un clic sur « Confirmer quand même » (docs/adr/0007).
 */
export function AppointmentForm(props: Props) {
  const { practitioners, types, timeZone } = props;
  const initial: Values =
    props.mode === 'create'
      ? {
          practitionerId: props.defaults.practitionerId,
          appointmentTypeId: types.find((t) => t.status === 'ACTIVE')?.id ?? '',
          date: props.defaults.date,
          time: props.defaults.time,
          duration: String(types.find((t) => t.status === 'ACTIVE')?.durationMinutes ?? 30),
          note: '',
        }
      : {
          practitionerId: props.appointment.practitionerId,
          appointmentTypeId: props.appointment.appointmentType.id,
          ...(({ date, time }) => ({ date, time }))(
            localDateTimeOf(props.appointment.startAt, timeZone),
          ),
          duration: String(props.appointment.durationMinutes),
          note: props.appointment.note ?? '',
        };
  const [values, setValues] = useState<Values>(initial);
  const [patient, setPatient] = useState<PatientSummary | null>(
    props.mode === 'create' ? props.defaults.patient : null,
  );
  // Raisons et message du serveur, en attente d'une confirmation explicite.
  const [confirmation, setConfirmation] = useState<{
    message: string;
    reasons: readonly OverrideReason[];
  } | null>(null);

  const duration = validDuration(values.duration);
  const slots = useQuery({
    queryKey: ['slots', values.practitionerId, values.date, duration],
    queryFn: () =>
      api.slots({
        practitionerId: values.practitionerId,
        from: values.date,
        to: values.date,
        durationMinutes: duration ?? 0,
      }),
    enabled: Boolean(values.practitionerId && values.date && duration),
  });

  // Clé de la saisie (ADR 0007) : gardée pour chaque nouvel essai tant que l'issue est inconnue
  // (réseau coupé, réponse perdue, erreur serveur) ; le serveur renvoie alors le rendez-vous
  // déjà créé au lieu de refuser un créneau « déjà pris » par cette même saisie.
  const idempotency = useIdempotencyKey();
  const save = useMutation({
    mutationFn: (allowOutsideAvailability: boolean) => {
      const start = `${values.date}T${values.time}`;
      const note = values.note.trim() || null;
      if (props.mode === 'create') {
        return api.createAppointment({
          practitionerId: values.practitionerId,
          patientId: patient?.id ?? '',
          appointmentTypeId: values.appointmentTypeId,
          start,
          durationMinutes: duration ?? 0,
          note,
          allowOutsideAvailability,
          idempotencyKey: idempotency.key,
        });
      }
      // Seuls les champs modifiés sont envoyés : le serveur ne revérifie le créneau que si le
      // rendez-vous est déplacé.
      const a = props.appointment;
      const changed = <T,>(next: T, before: T) => (next === before ? undefined : next);
      return api.updateAppointment(a.id, {
        version: a.version,
        ...defined({
          practitionerId: changed(values.practitionerId, initial.practitionerId),
          appointmentTypeId: changed(values.appointmentTypeId, initial.appointmentTypeId),
          start: changed(start, `${initial.date}T${initial.time}`),
          durationMinutes: changed(duration ?? 0, Number(initial.duration)),
          note: changed(note, initial.note.trim() || null),
        }),
        allowOutsideAvailability,
      });
    },
    onSuccess: (appointment) => {
      idempotency.renew();
      props.onSaved(appointment);
    },
    onError: (error) => {
      idempotency.afterError(error);
      if (error instanceof ApiError && error.code === 'AVAILABILITY_CONFIRMATION_REQUIRED') {
        setConfirmation({ message: error.message, reasons: error.reasons });
      }
    },
  });

  // Toute modification invalide une confirmation demandée pour l'ancienne saisie.
  const set = (patch: Partial<Values>) => {
    setValues({ ...values, ...patch });
    setConfirmation(null);
    save.reset();
  };

  const unchanged =
    props.mode === 'edit' &&
    (Object.keys(initial) as (keyof Values)[]).every((k) => values[k] === initial[k]);
  const problem = !values.practitionerId
    ? 'Choisissez un praticien.'
    : props.mode === 'create' && !patient
      ? 'Choisissez un patient.'
      : !values.appointmentTypeId
        ? 'Choisissez un type de rendez-vous.'
        : !values.date || !values.time
          ? 'Indiquez la date et l’heure.'
          : duration === null
            ? `Durée entre ${MIN_APPOINTMENT_MINUTES} et ${MAX_APPOINTMENT_MINUTES} minutes, par pas de 5.`
            : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (problem || unchanged) return;
    save.mutate(false);
  }

  // Options : éléments actifs, plus l'élément actuel s'il a été archivé depuis.
  const practitionerOptions = practitioners.filter(
    (p) => p.status === 'ACTIVE' || p.id === initial.practitionerId,
  );
  const typeOptions = types.filter(
    (t) => t.status === 'ACTIVE' || t.id === initial.appointmentTypeId,
  );
  const error = save.error;
  const refusal =
    error && !(error instanceof ApiError && error.code === 'AVAILABILITY_CONFIRMATION_REQUIRED');

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {props.mode === 'create' ? (
        <PatientPicker
          canCreate={props.canCreatePatient ?? false}
          value={patient}
          onChange={(p) => {
            setPatient(p);
            setConfirmation(null);
            save.reset();
          }}
        />
      ) : (
        <p className="text-sm">
          <span className="font-medium">Patient :</span> {patientLabel(props.appointment.patient)}
        </p>
      )}
      <SelectField
        label="Praticien"
        value={values.practitionerId}
        onChange={(e) => set({ practitionerId: e.target.value })}
      >
        {practitionerOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
            {p.status === 'ARCHIVED' ? ' (archivé)' : ''}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Type de rendez-vous"
        value={values.appointmentTypeId}
        onChange={(e) => {
          // La durée du type est la durée par défaut ; elle reste modifiable ensuite.
          const type = types.find((t) => t.id === e.target.value);
          set({
            appointmentTypeId: e.target.value,
            ...(type ? { duration: String(type.durationMinutes) } : {}),
          });
        }}
      >
        {typeOptions.length === 0 && <option value="">Aucun type de rendez-vous</option>}
        {typeOptions.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.durationMinutes} min){t.status === 'ARCHIVED' ? ' (archivé)' : ''}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Date"
          type="date"
          value={values.date}
          onChange={(e) => set({ date: e.target.value })}
        />
        <TextField
          label="Heure"
          type="time"
          step={300}
          value={values.time}
          onChange={(e) => set({ time: e.target.value })}
        />
      </div>
      <TextField
        label="Durée (minutes)"
        type="number"
        inputMode="numeric"
        min={MIN_APPOINTMENT_MINUTES}
        max={MAX_APPOINTMENT_MINUTES}
        step={5}
        value={values.duration}
        onChange={(e) => set({ duration: e.target.value })}
        hint="Par défaut, la durée du type de rendez-vous."
      />
      <SlotSuggestions
        query={slots}
        timeZone={timeZone}
        selected={values.time}
        onPick={(time) => set({ time })}
      />
      <TextArea
        label="Note (facultatif)"
        maxLength={500}
        value={values.note}
        onChange={(e) => set({ note: e.target.value })}
        hint="Information d'organisation, visible par tout le personnel. Aucune information médicale."
      />
      <p className="text-xs text-slate-600">Heures du cabinet ({timeZone}).</p>
      {problem && <p className="text-sm text-slate-700">{problem}</p>}
      {refusal && <Alert>{errorMessage(error)}</Alert>}
      {confirmation ? (
        <div className="flex flex-col gap-2">
          <Alert tone="warning">
            <p className="font-semibold">Confirmation nécessaire :</p>
            {confirmation.reasons.length > 0 && (
              <ul className="my-1 list-disc pl-5 font-semibold">
                {confirmation.reasons.map((r) => (
                  <li key={r}>{OVERRIDE_REASON_LABELS[r]}</li>
                ))}
              </ul>
            )}
            <p>{confirmation.message}</p>
            <p className="mt-1">
              Confirmez uniquement si ce rendez-vous est voulu : la dérogation est enregistrée dans
              le journal d&apos;audit.
            </p>
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button disabled={save.isPending} onClick={() => save.mutate(true)}>
              Confirmer quand même
            </Button>
            <Button variant="secondary" onClick={() => setConfirmation(null)}>
              Modifier la saisie
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || Boolean(problem) || unchanged}>
            {props.mode === 'create'
              ? 'Enregistrer le rendez-vous'
              : 'Enregistrer les modifications'}
          </Button>
          <Button variant="secondary" onClick={props.onCancel}>
            Annuler la saisie
          </Button>
        </div>
      )}
    </form>
  );
}

function defined<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

function SlotSuggestions({
  query,
  timeZone,
  selected,
  onPick,
}: {
  query: UseQueryResult<{ timezone: string; slots: string[] }>;
  timeZone: string;
  selected: string;
  onPick: (time: string) => void;
}) {
  if (query.fetchStatus === 'idle' && query.isPending) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium text-slate-800" id="slots-label">
        Créneaux libres ce jour
      </p>
      {query.isPending && <p className="text-sm text-slate-600">Recherche…</p>}
      {query.isError && <p className="text-sm text-red-700">{errorMessage(query.error)}</p>}
      {query.data?.slots.length === 0 && (
        <p className="text-sm text-slate-600">Aucun créneau libre ce jour pour cette durée.</p>
      )}
      {query.data && query.data.slots.length > 0 && (
        <ul aria-labelledby="slots-label" className="flex flex-wrap gap-1">
          {query.data.slots.slice(0, 16).map((slot) => {
            const time = formatTime(slot, timeZone);
            return (
              <li key={slot}>
                <button
                  type="button"
                  aria-pressed={time === selected}
                  onClick={() => onPick(time)}
                  className="min-h-11 rounded-md px-3 text-sm ring-1 ring-slate-300 hover:bg-sky-50 aria-pressed:bg-sky-700 aria-pressed:text-white"
                >
                  {time}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Recherche d'un patient actif (nom, téléphone ou date de naissance). */
function PatientPicker({
  canCreate,
  value,
  onChange,
}: {
  canCreate: boolean;
  value: PatientSummary | null;
  onChange: (patient: PatientSummary | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search.trim(), 250);
  const results = useQuery({
    queryKey: ['patients', 'picker', q],
    queryFn: () => api.listPatients({ q, status: 'ACTIVE', limit: 8 }),
    enabled: q.length >= 2,
  });

  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-sm">
          <span className="font-medium">Patient :</span> {patientLabel(value)}
          {value.primaryPhone ? ` · ${formatPhone(value.primaryPhone)}` : ''}
        </p>
        <Button variant="secondary" onClick={() => onChange(null)}>
          Changer de patient
        </Button>
      </div>
    );
  }
  if (creating) {
    return (
      <QuickPatientForm
        initialName={search.trim()}
        onCancel={() => setCreating(false)}
        onCreated={(p) => {
          setCreating(false);
          onChange(p);
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Patient"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        hint="Nom, téléphone ou date de naissance (JJ/MM/AAAA)."
        autoComplete="off"
      />
      {results.isError && <Alert>{errorMessage(results.error)}</Alert>}
      {results.data && (
        <ul aria-label="Patients trouvés" className="flex flex-col gap-1">
          {results.data.patients.length === 0 && (
            <li className="text-sm text-slate-600">Aucun patient trouvé.</li>
          )}
          {results.data.patients.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onChange(p)}
                className="flex min-h-11 w-full flex-wrap items-center gap-x-2 rounded-md px-3 text-left text-sm ring-1 ring-slate-200 hover:bg-sky-50"
              >
                <span className="font-medium">{patientLabel(p)}</span>
                {p.birthDate && <span className="text-slate-600">{formatDate(p.birthDate)}</span>}
                {p.primaryPhone && (
                  <span className="text-slate-600">{formatPhone(p.primaryPhone)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <div>
          <Button variant="secondary" onClick={() => setCreating(true)}>
            Nouveau patient
          </Button>
        </div>
      )}
    </div>
  );
}
