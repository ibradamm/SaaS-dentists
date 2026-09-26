import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Alert, AuthLayout, Button, Loading, TextField } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { ME_QUERY_KEY, pathAfterLogin, useMe } from '../lib/auth';

export function LoginPage() {
  const { data: me, isPending } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: api.login,
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      await navigate(pathAfterLogin(res.restriction), { replace: true });
    },
  });

  if (isPending) return <Loading />;
  if (me) return <Navigate to={pathAfterLogin(me.restriction)} replace />;

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate({ email, password });
  }

  return (
    <AuthLayout title="Connexion">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {login.isError && <Alert>{errorMessage(login.error)}</Alert>}
        <TextField
          label="Adresse e-mail"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" disabled={login.isPending || !email || !password}>
          {login.isPending ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </AuthLayout>
  );
}
