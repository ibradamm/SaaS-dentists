import { PASSWORD_MIN_LENGTH } from '@dental/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, TextField } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { ME_QUERY_KEY, pathAfterLogin } from '../lib/auth';
import { LogoutButton } from './LogoutButton';

export function ChangePasswordPage() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: api.changePassword,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await navigate(pathAfterLogin(res.restriction), { replace: true });
    },
  });
  const mismatch = confirmation.length > 0 && confirmation !== newPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < PASSWORD_MIN_LENGTH;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mismatch || tooShort) return;
    change.mutate({ currentPassword, newPassword });
  }

  return (
    <AuthLayout title="Choisissez votre mot de passe">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-slate-700">
          Votre mot de passe actuel est temporaire. Choisissez un mot de passe personnel.
        </p>
        {change.isError && <Alert>{errorMessage(change.error)}</Alert>}
        <TextField
          label="Mot de passe actuel (temporaire)"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <TextField
          label="Nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          hint={`${PASSWORD_MIN_LENGTH} caractères minimum. Une phrase facile à retenir convient très bien.`}
          error={tooShort ? `${PASSWORD_MIN_LENGTH} caractères minimum` : undefined}
          value={newPassword}
          onChange={(e) => setNew(e.target.value)}
        />
        <TextField
          label="Confirmation"
          type="password"
          autoComplete="new-password"
          error={mismatch ? 'Les deux mots de passe diffèrent' : undefined}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        <Button
          type="submit"
          disabled={
            change.isPending ||
            !currentPassword ||
            !newPassword ||
            mismatch ||
            tooShort ||
            !confirmation
          }
        >
          Enregistrer
        </Button>
        <LogoutButton />
      </form>
    </AuthLayout>
  );
}
