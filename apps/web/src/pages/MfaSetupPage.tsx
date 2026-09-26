import type { MfaSetupResponse } from '@dental/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, TextField } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { ME_QUERY_KEY, pathAfterLogin } from '../lib/auth';
import { LogoutButton } from './LogoutButton';

interface SetupState extends MfaSetupResponse {
  qrSvg: string;
}

export function MfaSetupPage() {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [code, setCode] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: async () => {
      const res = await api.setupMfa();
      // SVG plutôt que canvas : rendu net et aucune dépendance au canvas du navigateur.
      const qrSvg = await QRCode.toString(res.otpauthUri, { type: 'svg', margin: 1, width: 200 });
      return { ...res, qrSvg };
    },
    onSuccess: setSetup,
  });
  const activate = useMutation({
    mutationFn: api.activateMfa,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await navigate(pathAfterLogin(res.restriction), { replace: true });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    activate.mutate(code);
  }

  return (
    <AuthLayout title="Double authentification">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-700">
          Votre rôle exige une double authentification. Installez une application
          d&apos;authentification (Google Authenticator, Microsoft Authenticator, etc.) sur votre
          téléphone.
        </p>
        {start.isError && <Alert>{errorMessage(start.error)}</Alert>}
        {!setup ? (
          <Button onClick={() => start.mutate()} disabled={start.isPending}>
            Commencer
          </Button>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
              alt="QR code à scanner avec l'application d'authentification"
              className="mx-auto h-48 w-48"
            />
            <p className="text-sm text-slate-700">
              Impossible de scanner ? Saisissez cette clé dans l&apos;application :
              <code className="mt-1 block break-all rounded bg-slate-100 p-2 text-sm">
                {setup.secret}
              </code>
            </p>
            {activate.isError && <Alert>{errorMessage(activate.error)}</Alert>}
            <TextField
              label="Code affiché par l'application"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <Button type="submit" disabled={activate.isPending || code.length !== 6}>
              Activer
            </Button>
          </form>
        )}
        <LogoutButton />
      </div>
    </AuthLayout>
  );
}
