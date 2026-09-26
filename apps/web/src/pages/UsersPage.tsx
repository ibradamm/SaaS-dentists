import { ROLE_LABELS, ROLES, type ClinicUser, type Role } from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Loading, SelectField, TextField } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useMe } from '../lib/auth';

const USERS_KEY = ['users'] as const;

function TemporaryPassword({
  email,
  password,
  onDone,
}: {
  email: string;
  password: string;
  onDone: () => void;
}) {
  return (
    <Alert tone="success">
      <p>
        Mot de passe temporaire pour <strong>{email}</strong>, à transmettre à la personne. Il ne
        sera plus affiché ; il devra être changé à la première connexion.
      </p>
      <code className="my-2 block rounded bg-white p-2 text-base tracking-wide">{password}</code>
      <Button variant="secondary" onClick={onDone}>
        J&apos;ai transmis le mot de passe
      </Button>
    </Alert>
  );
}

function CreateUserForm({ onCreated }: { onCreated: (email: string, password: string) => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role>('SECRETARY');
  const create = useMutation({
    mutationFn: api.createUser,
    onSuccess: async (res) => {
      onCreated(res.user.email, res.temporaryPassword);
      setEmail('');
      setFullName('');
      await queryClient.invalidateQueries({ queryKey: USERS_KEY });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate({ email, fullName, role });
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4 sm:items-end"
    >
      <h2 className="text-lg font-semibold sm:col-span-4">Ajouter un utilisateur</h2>
      {create.isError && (
        <div className="sm:col-span-4">
          <Alert>{errorMessage(create.error)}</Alert>
        </div>
      )}
      <TextField
        label="Nom complet"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <TextField
        label="Adresse e-mail"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <SelectField label="Rôle" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </SelectField>
      <Button type="submit" disabled={create.isPending || !email || !fullName}>
        Ajouter
      </Button>
    </form>
  );
}

function UserRow({
  user,
  isSelf,
  onPassword,
}: {
  user: ClinicUser;
  isSelf: boolean;
  onPassword: (email: string, password: string) => void;
}) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: USERS_KEY });
  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.updateUser>[1]) => api.updateUser(user.id, body),
    onSuccess: refresh,
  });
  const resetPassword = useMutation({
    mutationFn: () => api.resetPassword(user.id),
    onSuccess: async (res) => {
      onPassword(res.user.email, res.temporaryPassword);
      await refresh();
    },
  });
  const resetMfa = useMutation({ mutationFn: () => api.resetMfa(user.id), onSuccess: refresh });
  const error = update.error ?? resetPassword.error ?? resetMfa.error;
  const busy = update.isPending || resetPassword.isPending || resetMfa.isPending;

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="font-medium">
          {user.fullName} {isSelf && <span className="text-sm text-slate-500">(vous)</span>}
        </p>
        <p className="text-sm text-slate-600">{user.email}</p>
        <p className="text-sm text-slate-600">
          {user.status === 'ACTIVE' ? 'Actif' : 'Désactivé'} · Double authentification :{' '}
          {user.mfaEnabled ? 'activée' : 'non configurée'}
        </p>
        {error && <Alert>{errorMessage(error)}</Alert>}
      </div>
      {!isSelf && (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField
            label="Rôle"
            value={user.role}
            disabled={busy}
            onChange={(e) => {
              const role = e.target.value as Role;
              const question = `Donner le rôle « ${ROLE_LABELS[role]} » à ${user.fullName} ? Ses sessions en cours seront fermées.`;
              if (window.confirm(question)) update.mutate({ role });
            }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </SelectField>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              const disabling = user.status === 'ACTIVE';
              if (
                !disabling ||
                window.confirm(
                  `Désactiver le compte de ${user.fullName} ? Ses sessions seront fermées.`,
                )
              ) {
                update.mutate({ status: disabling ? 'DISABLED' : 'ACTIVE' });
              }
            }}
          >
            {user.status === 'ACTIVE' ? 'Désactiver' : 'Réactiver'}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Réinitialiser le mot de passe de ${user.fullName} ?`))
                resetPassword.mutate();
            }}
          >
            Réinitialiser le mot de passe
          </Button>
          {user.mfaEnabled && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(`Réinitialiser la double authentification de ${user.fullName} ?`)
                )
                  resetMfa.mutate();
              }}
            >
              Réinitialiser la double authentification
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function UsersPage() {
  const { data: me } = useMe();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: api.listUsers });
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);
  const reveal = (email: string, password: string) => setShown({ email, password });

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Utilisateurs</h1>
      {shown && <TemporaryPassword {...shown} onDone={() => setShown(null)} />}
      <CreateUserForm onCreated={reveal} />
      {users.isPending && <Loading />}
      {users.isError && <Alert>{errorMessage(users.error)}</Alert>}
      {users.data && (
        <ul className="flex flex-col gap-2" aria-label="Liste des utilisateurs">
          {users.data.map((u) => (
            <UserRow key={u.id} user={u} isSelf={u.id === me?.user.id} onPassword={reveal} />
          ))}
        </ul>
      )}
    </section>
  );
}
