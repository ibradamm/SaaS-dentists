import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { ME_QUERY_KEY } from '../lib/auth';

export function LogoutButton({ variant = 'secondary' }: { variant?: 'secondary' | 'primary' }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: async () => {
      queryClient.setQueryData(ME_QUERY_KEY, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_QUERY_KEY[0] });
      await navigate('/connexion', { replace: true });
    },
  });
  return (
    <Button variant={variant} onClick={() => logout.mutate()} disabled={logout.isPending}>
      Se déconnecter
    </Button>
  );
}
