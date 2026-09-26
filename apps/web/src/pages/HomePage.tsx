import { useMe } from '../lib/auth';

/** Tableau de bord provisoire : l'agenda et les patients arrivent aux phases 4, 3 et 8. */
export function HomePage() {
  const { data: me } = useMe();
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Bonjour {me?.user.fullName}</h1>
      <p className="text-slate-700">
        Agenda, patients et rendez-vous seront disponibles dans les prochaines étapes du projet.
      </p>
    </section>
  );
}
