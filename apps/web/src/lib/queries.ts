import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/*
 * Clés et lectures partagées entre pages. Elles vivent ici, et non dans une page : importer une
 * constante depuis une page embarquerait toute la page dans le fichier d'une autre.
 */
export const CLINIC_QUERY_KEY = ['clinic'] as const;
export const PRACTITIONERS_KEY = ['practitioners'] as const;
export const APPOINTMENT_TYPES_KEY = ['appointment-types'] as const;

export const useClinic = () => useQuery({ queryKey: CLINIC_QUERY_KEY, queryFn: api.clinic });

/** Praticiens, archivés compris (noms des rendez-vous passés). */
export const useAllPractitioners = () =>
  useQuery({ queryKey: [...PRACTITIONERS_KEY, 'all'], queryFn: () => api.listPractitioners(true) });

/** Types de rendez-vous, archivés compris. */
export const useAllAppointmentTypes = () =>
  useQuery({
    queryKey: [...APPOINTMENT_TYPES_KEY, 'all'],
    queryFn: () => api.listAppointmentTypes(true),
  });
