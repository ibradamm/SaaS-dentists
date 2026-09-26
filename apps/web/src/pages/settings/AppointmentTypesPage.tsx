import type { AppointmentType } from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Loading, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { COLORS, ColorField, ColorSwatch } from './colors';

export const APPOINTMENT_TYPES_KEY = ['appointment-types'] as const;

interface FormValues {
  name: string;
  durationMinutes: string;
  color: string;
}

const validDuration = (value: string) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 5 && n <= 480 && n % 5 === 0;
};

function TypeForm({
  title,
  initial,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: FormValues;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(values);
  }
  const durationError =
    values.durationMinutes !== '' && !validDuration(values.durationMinutes)
      ? 'Entre 5 et 480 minutes, par pas de 5'
      : undefined;
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3 sm:items-end"
      noValidate
    >
      <h2 className="text-lg font-semibold sm:col-span-3">{title}</h2>
      {error !== null && error !== undefined && (
        <div className="sm:col-span-3">
          <Alert>{errorMessage(error)}</Alert>
        </div>
      )}
      <TextField
        label="Nom"
        placeholder="Détartrage"
        maxLength={100}
        value={values.name}
        onChange={(e) => setValues({ ...values, name: e.target.value })}
      />
      <TextField
        label="Durée (minutes)"
        type="number"
        min={5}
        max={480}
        step={5}
        value={values.durationMinutes}
        error={durationError}
        onChange={(e) => setValues({ ...values, durationMinutes: e.target.value })}
      />
      <ColorField value={values.color} onChange={(color) => setValues({ ...values, color })} />
      <div className="flex flex-wrap gap-2 sm:col-span-3">
        <Button
          type="submit"
          disabled={busy || values.name.trim() === '' || !validDuration(values.durationMinutes)}
        >
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

function TypeRow({ type }: { type: AppointmentType }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: APPOINTMENT_TYPES_KEY });
  const update = useMutation({
    mutationFn: (values: FormValues) =>
      api.updateAppointmentType(type.id, {
        version: type.version,
        name: values.name,
        durationMinutes: Number(values.durationMinutes),
        color: values.color,
      }),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: () =>
      type.status === 'ACTIVE'
        ? api.archiveAppointmentType(type.id, type.version)
        : api.restoreAppointmentType(type.id, type.version),
    onSuccess: refresh,
  });
  if (editing) {
    return (
      <li>
        <TypeForm
          title={`Modifier ${type.name}`}
          initial={{
            name: type.name,
            durationMinutes: String(type.durationMinutes),
            color: type.color,
          }}
          submitLabel="Enregistrer"
          busy={update.isPending}
          error={update.error}
          onSubmit={(values) => update.mutate(values)}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
      <span className="flex flex-wrap items-center gap-2">
        <ColorSwatch color={type.color} />
        <span className="font-medium">{type.name}</span>
        <span className="text-sm text-slate-600">{type.durationMinutes} min</span>
        {type.status === 'ARCHIVED' && <Badge>Archivé</Badge>}
      </span>
      <span className="flex flex-wrap gap-2">
        {toggle.isError && <Alert>{errorMessage(toggle.error)}</Alert>}
        {type.status === 'ACTIVE' && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Modifier
          </Button>
        )}
        <Button
          variant={type.status === 'ACTIVE' ? 'danger' : 'secondary'}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {type.status === 'ACTIVE' ? 'Archiver' : 'Restaurer'}
        </Button>
      </span>
    </li>
  );
}

export function AppointmentTypesPage() {
  const queryClient = useQueryClient();
  const types = useQuery({
    queryKey: [...APPOINTMENT_TYPES_KEY, 'all'],
    queryFn: () => api.listAppointmentTypes(true),
  });
  const [formKey, setFormKey] = useState(0);
  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.createAppointmentType({
        name: values.name,
        durationMinutes: Number(values.durationMinutes),
        color: values.color,
      }),
    onSuccess: async () => {
      setFormKey((k) => k + 1);
      await queryClient.invalidateQueries({ queryKey: APPOINTMENT_TYPES_KEY });
    },
  });
  if (types.isPending) return <Loading />;
  if (types.isError) return <Alert>{errorMessage(types.error)}</Alert>;
  const nextColor = COLORS[types.data.length % COLORS.length]!.value;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-700">
        La durée d&apos;un type est proposée à la prise de rendez-vous ; elle pourra être ajustée
        rendez-vous par rendez-vous.
      </p>
      {types.data.length === 0 && (
        <Alert tone="info">Aucun type de rendez-vous pour l&apos;instant.</Alert>
      )}
      <ul className="flex flex-col gap-2" aria-label="Types de rendez-vous">
        {types.data.map((t) => (
          <TypeRow key={`${t.id}-${t.version}`} type={t} />
        ))}
      </ul>
      <TypeForm
        key={formKey}
        title="Ajouter un type de rendez-vous"
        initial={{ name: '', durationMinutes: '30', color: nextColor }}
        submitLabel="Ajouter"
        busy={create.isPending}
        error={create.error}
        onSubmit={(values) => create.mutate(values)}
      />
    </div>
  );
}
