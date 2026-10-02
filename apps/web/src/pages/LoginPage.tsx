import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, Loading, TextField } from '../components/ui';
import { ApiError, api, errorMessage } from '../lib/api';
import { ME_QUERY_KEY, pathAfterLogin, useMe } from '../lib/auth';

export function LoginPage() {
  const { data: me, isPending } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Compte rattaché à plusieurs cabinets : le serveur les propose après le mot de passe.
  const [clinics, setClinics] = useState<readonly { id: string; name: string }[]>([]);
  const [clinicId, setClinicId] = useState('');
  const login = useMutation({
    mutationFn: api.login,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await navigate(pathAfterLogin(res.restriction), { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'CLINIC_SELECTION_REQUIRED') {
        setClinics(error.clinics);
        setClinicId(error.clinics[0]?.id ?? '');
      }
    },
  });
  const choosing = clinics.length > 0;

  if (isPending) return <Loading />;
  if (me) return <Navigate to={pathAfterLogin(me.restriction)} replace />;

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password, ...(choosing && clinicId ? { clinicId } : {}) });
  }
  // Autre adresse ou autre mot de passe : le choix précédent ne vaut plus.
  function resetChoice() {
    setClinics([]);
    setClinicId('');
  }
  const selectionError =
    login.error instanceof ApiError && login.error.code === 'CLINIC_SELECTION_REQUIRED';

  return (
    <AuthLayout title="Connexion">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {login.isError && !selectionError && <Alert>{errorMessage(login.error)}</Alert>}
        <TextField
          label="Adresse e-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            resetChoice();
          }}
        />
        <TextField
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            resetChoice();
          }}
        />
        {choosing && (
          <fieldset className="flex flex-col gap-2 rounded-md border border-slate-300 p-3">
            <legend className="px-1 text-sm font-medium text-slate-800">Cabinet</legend>
            <p className="text-sm text-slate-700">
              Votre compte est rattaché à plusieurs cabinets : choisissez celui à ouvrir.
            </p>
            {clinics.map((c) => (
              <label key={c.id} className="flex min-h-11 items-center gap-2 text-base">
                <input
                  type="radio"
                  name="cabinet"
                  value={c.id}
                  checked={clinicId === c.id}
                  onChange={() => setClinicId(c.id)}
                />
                {c.name}
              </label>
            ))}
          </fieldset>
        )}
        <Button type="submit" disabled={login.isPending || !email || !password}>
          {login.isPending ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </AuthLayout>
  );
}
