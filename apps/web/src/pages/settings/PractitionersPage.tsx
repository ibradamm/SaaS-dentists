import type { ClinicUser, Practitioner } from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Loading, SelectField, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useMe } from '../../lib/auth';
import { COLORS, ColorField, ColorSwatch } from './colors';
import { PRACTITIONERS_KEY } from '../../lib/queries';

interface FormValues {
  displayName: string;
  color: string;
  userId: string;
}

function PractitionerForm({
  title,
  initial,
  users,
  linkedUserIds,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: FormValues;
  users: ClinicUser[];
  linkedUserIds: Set<string>;
  submitLabel: string;
  busy: boolean;
  error: unknown;
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(initial);
  // Comptes actifs non liés à un autre praticien (plus le compte déjà lié, en modification).
  const choices = users.filter(
    (u) => u.status === 'ACTIVE' && (!linkedUserIds.has(u.id) || u.id === initial.userId),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(values);
  }
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
        label="Nom affiché"
        placeholder="Dr Martin"
        maxLength={100}
        value={values.displayName}
        onChange={(e) => setValues({ ...values, displayName: e.target.value })}
      />
      <ColorField value={values.color} onChange={(color) => setValues({ ...values, color })} />
      <SelectField
        label="Compte de connexion lié"
        value={values.userId}
        onChange={(e) => setValues({ ...values, userId: e.target.value })}
      >
        <option value="">Aucun (ne se connecte pas)</option>
        {choices.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName} ({u.email})
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap gap-2 sm:col-span-3">
        <Button type="submit" disabled={busy || values.displayName.trim() === ''}>
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

function PractitionerRow({
  practitioner,
  users,
  linkedUserIds,
}: {
  practitioner: Practitioner;
  users: ClinicUser[];
  linkedUserIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: PRACTITIONERS_KEY });
  const update = useMutation({
    mutationFn: (values: FormValues) =>
      api.updatePractitioner(practitioner.id, {
        version: practitioner.version,
        displayName: values.displayName,
        color: values.color,
        userId: values.userId || null,
      }),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: () =>
      practitioner.status === 'ACTIVE'
        ? api.archivePractitioner(practitioner.id, practitioner.version)
        : api.restorePractitioner(practitioner.id, practitioner.version),
    onSuccess: refresh,
  });

  if (editing) {
    return (
      <li>
        <PractitionerForm
          title={`Modifier ${practitioner.displayName}`}
          initial={{
            displayName: practitioner.displayName,
            color: practitioner.color,
            userId: practitioner.userId ?? '',
          }}
          users={users}
          linkedUserIds={linkedUserIds}
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
        <ColorSwatch color={practitioner.color} />
        <span className="font-medium">{practitioner.displayName}</span>
        <span className="text-sm text-slate-600">
          {practitioner.userFullName ? `Compte : ${practitioner.userFullName}` : 'Sans compte'}
        </span>
        {practitioner.status === 'ARCHIVED' && <Badge>Archivé</Badge>}
      </span>
      <span className="flex flex-wrap gap-2">
        {toggle.isError && <Alert>{errorMessage(toggle.error)}</Alert>}
        {practitioner.status === 'ACTIVE' && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Modifier
          </Button>
        )}
        <Button
          variant={practitioner.status === 'ACTIVE' ? 'danger' : 'secondary'}
          disabled={toggle.isPending}
          onClick={() => {
            if (
              practitioner.status === 'ACTIVE' &&
              !window.confirm(
                `Archiver ${practitioner.displayName} ? Son agenda ne sera plus modifiable.`,
              )
            ) {
              return;
            }
            toggle.mutate();
          }}
        >
          {practitioner.status === 'ACTIVE' ? 'Archiver' : 'Restaurer'}
        </Button>
      </span>
    </li>
  );
}

export function PractitionersPage() {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const practitioners = useQuery({
    queryKey: [...PRACTITIONERS_KEY, 'all'],
    queryFn: () => api.listPractitioners(true),
  });
  const users = useQuery({ queryKey: ['users'], queryFn: api.listUsers });
  const [formKey, setFormKey] = useState(0);
  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.createPractitioner({
        displayName: values.displayName,
        color: values.color,
        userId: values.userId || null,
      }),
    onSuccess: async () => {
      setFormKey((k) => k + 1);
      await queryClient.invalidateQueries({ queryKey: PRACTITIONERS_KEY });
    },
  });

  if (practitioners.isPending || users.isPending) return <Loading />;
  if (practitioners.isError) return <Alert>{errorMessage(practitioners.error)}</Alert>;
  if (users.isError) return <Alert>{errorMessage(users.error)}</Alert>;

  const list = practitioners.data;
  const linkedUserIds = new Set(
    list.map((p) => p.userId).filter((id): id is string => id !== null),
  );
  const nextColor = COLORS[list.length % COLORS.length]!.value;
  const meLinked = me ? linkedUserIds.has(me.user.id) : true;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-700">
        Un praticien est une personne qui reçoit des rendez-vous. Il peut être lié à un compte de
        connexion : un dentiste lié gère alors lui-même ses horaires et ses absences. Un cabinet
        peut avoir un seul praticien ou plusieurs.
      </p>
      {list.length === 0 && <Alert tone="info">Aucun praticien pour l&apos;instant.</Alert>}
      <ul className="flex flex-col gap-2" aria-label="Praticiens">
        {list.map((p) => (
          <PractitionerRow
            key={`${p.id}-${p.version}`}
            practitioner={p}
            users={users.data}
            linkedUserIds={linkedUserIds}
          />
        ))}
      </ul>
      {me && !meLinked && (
        <div>
          <Button
            variant="secondary"
            disabled={create.isPending}
            onClick={() =>
              create.mutate({ displayName: me.user.fullName, color: nextColor, userId: me.user.id })
            }
          >
            M&apos;ajouter comme praticien
          </Button>
        </div>
      )}
      <PractitionerForm
        key={formKey}
        title="Ajouter un praticien"
        initial={{ displayName: '', color: nextColor, userId: '' }}
        users={users.data}
        linkedUserIds={linkedUserIds}
        submitLabel="Ajouter"
        busy={create.isPending}
        error={create.error}
        onSubmit={(values) => create.mutate(values)}
      />
    </div>
  );
}
