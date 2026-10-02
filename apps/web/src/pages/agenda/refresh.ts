import type { Appointment } from '@dental/shared';
import type { QueryClient } from '@tanstack/react-query';
import { DASHBOARD_KEY } from '../../lib/queries';

export const appointmentKey = (id: string) => ['appointment', id] as const;

/**
 * Après toute écriture : listes et disponibilités rechargées. Les disponibilités sont retirées
 * du cache (jamais d'état périmé affiché, voir BlocksPanel).
 */
export async function refreshAgenda(queryClient: QueryClient, appointment: Appointment) {
  queryClient.setQueryData(appointmentKey(appointment.id), appointment);
  queryClient.removeQueries({ queryKey: ['availability'] });
  queryClient.removeQueries({ queryKey: ['slots'] });
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['appointments'] }),
    queryClient.invalidateQueries({ queryKey: ['patient-appointments', appointment.patient.id] }),
    queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY }),
  ]);
}
