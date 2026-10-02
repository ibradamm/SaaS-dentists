import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, TextField } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { ME_QUERY_KEY, pathAfterLogin } from '../lib/auth';
import { LogoutButton } from './LogoutButton';

export function MfaVerifyPage() {
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const verify = useMutation({
    mutationFn: api.verifyMfa,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await navigate(pathAfterLogin(res.restriction), { replace: true });
    },
    onError: async (error) => {
      // Trop d'essais : la session est fermée côté serveur, retour à la connexion.
      if ((error as { code?: string }).code === 'UNAUTHENTICATED') {
        await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      }
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    verify.mutate(code);
  }

  return (
    <AuthLayout title="Code de vérification">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-slate-700">
          Saisissez le code à 6 chiffres affiché par votre application d&apos;authentification.
        </p>
        {verify.isError && <Alert>{errorMessage(verify.error)}</Alert>}
        <TextField
          label="Code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <Button type="submit" disabled={verify.isPending || code.length !== 6}>
          Valider
        </Button>
        <LogoutButton />
      </form>
    </AuthLayout>
  );
}
