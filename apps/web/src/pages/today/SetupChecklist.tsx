import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api';
import { addDays } from '../../lib/dates';
import { useAllAppointmentTypes, useAllPractitioners, useClinic } from '../../lib/queries';

/** Horizon de vérification des horaires : deux semaines à partir d'aujourd'hui. */
const HORIZON_DAYS = 14;

/**
 * Mise en route du cabinet (administrateur, ADR 0008) : ce qui manque pour qu'un rendez-vous
 * puisse être pris. Disparaît une fois tout en place.
 */
export function SetupChecklist({ today }: { today: string }) {
  const clinic = useClinic();
  const practitioners = useAllPractitioners();
  const types = useAllAppointmentTypes();
  const availability = useQuery({
    queryKey: ['availability', 'mise-en-route', today],
    queryFn: () => api.availability({ from: today, to: addDays(today, HORIZON_DAYS - 1) }),
  });
  if (!clinic.data || !practitioners.data || !types.data || !availability.data) return null;

  const active = practitioners.data.filter((p) => p.status === 'ACTIVE');
  const withoutHours = active.filter(
    (p) =>
      (availability.data.practitioners.find((x) => x.practitionerId === p.id)?.working.length ??
        0) === 0,
  );
  const todo: { key: string; text: string; to: string }[] = [];
  if (active.length === 0) {
    todo.push({
      key: 'praticien',
      text: 'Ajouter au moins un praticien (vous-même, si vous exercez seul)',
      to: '/cabinet/praticiens',
    });
  }
  for (const p of withoutHours) {
    todo.push({
      key: `horaires-${p.id}`,
      text: `Définir les horaires de ${p.displayName} (aucun dans les deux semaines à venir)`,
      to: `/disponibilites?praticien=${p.id}`,
    });
  }
  if (!types.data.some((t) => t.status === 'ACTIVE')) {
    todo.push({
      key: 'type',
      text: 'Créer un type de rendez-vous (nom, durée par défaut)',
      to: '/cabinet/types-de-rendez-vous',
    });
  }
  if (!clinic.data.phone || !clinic.data.addressLine1) {
    todo.push({
      key: 'profil',
      text: 'Compléter les coordonnées du cabinet (adresse, téléphone)',
      to: '/cabinet',
    });
  }
  if (todo.length === 0) return null;

  return (
    <section
      aria-labelledby="mise-en-route"
      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4"
    >
      <h2 id="mise-en-route" className="text-lg font-semibold text-amber-950">
        Mise en route du cabinet
      </h2>
      <ul className="flex flex-col gap-1">
        {todo.map((t) => (
          <li key={t.key}>
            <Link className="text-amber-950 underline" to={t.to}>
              {t.text}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
