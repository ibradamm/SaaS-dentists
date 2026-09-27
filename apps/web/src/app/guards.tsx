import type { Permission, SessionRestriction } from '@dental/shared';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Alert, Loading } from '../components/ui';
import { can, pathAfterLogin, useMe } from '../lib/auth';

/**
 * Accès à un groupe de pages selon l'étape d'authentification : `allow = null` exige un accès
 * complet ; sinon, seule la page de l'étape correspondante est accessible. Le serveur applique
 * la même règle : cette redirection n'est qu'un confort de navigation.
 */
export function RequireSession({ allow }: { allow: SessionRestriction | null }) {
  const { data: me, isPending, isError } = useMe();
  const location = useLocation();
  if (isPending) return <Loading />;
  if (isError) {
    return (
      <main className="p-6">
        <Alert>Le serveur ne répond pas. Réessayez dans quelques instants.</Alert>
      </main>
    );
  }
  if (!me) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (me.restriction !== allow) return <Navigate to={pathAfterLogin(me.restriction)} replace />;
  return <Outlet />;
}

/** Page réservée : une permission, ou au moins une d'une liste. */
export function RequirePermission({
  permission,
}: {
  permission: Permission | readonly Permission[];
}) {
  const { data: me } = useMe();
  const allowed = typeof permission === 'string' ? [permission] : permission;
  if (!allowed.some((p) => can(me, p))) {
    return (
      <div className="p-6">
        <Alert>Vous n&apos;avez pas accès à cette page.</Alert>
      </div>
    );
  }
  return <Outlet />;
}
