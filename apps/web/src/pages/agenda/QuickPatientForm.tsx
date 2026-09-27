import type { PatientSummary } from '@dental/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format-date';

/**
 * Nouveau patient créé sans quitter la prise de rendez-vous (parcours « appel d'un nouveau
 * patient », ADR 0008). Même règle que la page « Nouveau patient » : recherche de doublons
 * avant la création, la personne décide en connaissance de cause. Pas d'élément <form> : ce
 * bloc vit dans le formulaire du rendez-vous.
 */
export function QuickPatientForm({
  initialName,
  onCreated,
  onCancel,
}: {
  initialName: string;
  onCreated: (patient: PatientSummary) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  // Un nom saisi dans la recherche (sans chiffres) préremplit le champ « Nom ».
  const [form, setForm] = useState({
    lastName: /\d/.test(initialName) ? '' : initialName,
    firstName: '',
    phone: /\d/.test(initialName) ? initialName : '',
    birthDate: '',
  });
  const [duplicates, setDuplicates] = useState<PatientSummary[] | null>(null);
  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setDuplicates(null);
  };

  const create = useMutation({
    mutationFn: () =>
      api.createPatient({
        lastName: form.lastName,
        firstName: form.firstName,
        birthDate: form.birthDate || null,
        contacts: form.phone.trim() ? [{ phone: form.phone }] : [],
      }),
    onSuccess: async (patient) => {
      await queryClient.invalidateQueries({ queryKey: ['patients'] });
      onCreated(patient);
    },
  });
  const check = useMutation({
    mutationFn: () =>
      api.duplicatePatients({
        lastName: form.lastName,
        firstName: form.firstName,
        birthDate: form.birthDate || undefined,
      }),
    onSuccess: (candidates) => {
      if (candidates.length > 0) setDuplicates(candidates);
      else create.mutate();
    },
  });
  const missing = !form.lastName.trim() || !form.firstName.trim();
  const error = create.error ?? check.error;

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-sky-200 bg-sky-50 p-3">
      <legend className="px-1 text-sm font-semibold">Nouveau patient</legend>
      {error && <Alert>{errorMessage(error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Nom"
          required
          value={form.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
        />
        <TextField
          label="Prénom"
          required
          value={form.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
        />
        <TextField
          label="Téléphone"
          type="tel"
          autoComplete="off"
          value={form.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
        <TextField
          label="Date de naissance"
          type="date"
          value={form.birthDate}
          onChange={(e) => set({ birthDate: e.target.value })}
        />
      </div>
      {duplicates && (
        <div className="flex flex-col gap-2">
          <Alert tone="info">
            Patient(s) similaire(s) déjà enregistré(s) : vérifiez qu&apos;il ne s&apos;agit pas de
            la même personne.
          </Alert>
          <ul aria-label="Patients similaires" className="flex flex-col gap-1">
            {duplicates.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onCreated(d)}
                  className="flex min-h-11 w-full flex-wrap items-center gap-x-2 rounded-md bg-white px-3 text-left text-sm ring-1 ring-slate-200 hover:bg-sky-100"
                >
                  <span className="font-medium">
                    Choisir {d.lastName.toUpperCase()} {d.firstName}
                  </span>
                  {d.birthDate && (
                    <span className="text-slate-600">né(e) le {formatDate(d.birthDate)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={missing || create.isPending || check.isPending}
          onClick={() => (duplicates ? create.mutate() : check.mutate())}
        >
          {duplicates ? 'Créer quand même' : 'Créer le patient'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Revenir à la recherche
        </Button>
      </div>
    </fieldset>
  );
}
