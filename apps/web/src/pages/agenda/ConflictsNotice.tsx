import type { Appointment } from '@dental/shared';
import { Link } from 'react-router';
import { Alert } from '../../components/ui';
import { formatLocalDate, formatTime, localDateOf } from '../../lib/dates';

/**
 * Rendez-vous prévus touchés par une nouvelle absence, un blocage ou un changement d'horaires.
 * Ils ne sont jamais modifiés automatiquement (docs/adr/0007) : chacun mène à sa fiche.
 */
export function ConflictsNotice({
  conflicts,
  timeZone,
  reason,
}: {
  conflicts: Appointment[];
  timeZone: string;
  reason: string;
}) {
  if (conflicts.length === 0) return null;
  const n = conflicts.length;
  return (
    <Alert tone="warning">
      <p className="font-medium">
        {n === 1 ? '1 rendez-vous prévu est' : `${n} rendez-vous prévus sont`} {reason}. Rien
        n&apos;a été modifié : déplacez ou annulez ce qui doit l&apos;être.
      </p>
      <ul className="mt-1 list-disc pl-5">
        {conflicts.map((a) => {
          const day = localDateOf(a.startAt, timeZone);
          return (
            <li key={a.id}>
              <Link className="underline" to={`/agenda?date=${day}&rdv=${a.id}`}>
                {formatLocalDate(day)} {formatTime(a.startAt, timeZone)} ·{' '}
                {a.patient.lastName.toUpperCase()} {a.patient.firstName} · {a.appointmentType.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </Alert>
  );
}
