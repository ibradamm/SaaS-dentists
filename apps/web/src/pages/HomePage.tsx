import { useMe } from '../lib/auth';

/** Tableau de bord provisoire : l'agenda arrive en Phase 5, le tableau de bord en Phase 8. */
export function HomePage() {
  const { data: me } = useMe();
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Bonjour {me?.user.fullName}</h1>
      <p className="text-slate-700">
        Patients et disponibilités des praticiens sont accessibles depuis le menu. L&apos;agenda des
        rendez-vous arrive à l&apos;étape suivante du projet.
      </p>
    </section>
  );
}
