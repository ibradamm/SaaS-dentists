import { Link } from 'react-router';
import { can, useMe } from '../lib/auth';

/** Tableau de bord provisoire : le tableau de bord arrive en Phase 8. */
export function HomePage() {
  const { data: me } = useMe();
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Bonjour {me?.user.fullName}</h1>
      <p className="text-slate-700">
        Agenda, patients et disponibilités des praticiens sont accessibles depuis le menu.
      </p>
      {can(me, 'appointment.read') && (
        <p>
          <Link className="text-sky-800 underline" to="/agenda">
            Ouvrir l&apos;agenda du jour
          </Link>
        </p>
      )}
    </section>
  );
}
