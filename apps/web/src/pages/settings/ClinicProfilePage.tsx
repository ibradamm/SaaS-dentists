import type { ClinicResponse } from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Loading, SelectField, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { ME_QUERY_KEY } from '../../lib/auth';
import { timeZones } from '../../lib/dates';
import { formatPhone } from '../../lib/format';

export const CLINIC_QUERY_KEY = ['clinic'] as const;

const FIELDS = [
  'name',
  'timezone',
  'addressLine1',
  'addressLine2',
  'postalCode',
  'city',
  'phone',
  'email',
] as const;
type Field = (typeof FIELDS)[number];

/** Valeurs du formulaire (téléphone au format national pour la saisie). */
function valuesOf(clinic: ClinicResponse): Record<Field, string> {
  return Object.fromEntries(
    FIELDS.map((f) => [f, f === 'phone' ? formatPhone(clinic.phone) : (clinic[f] ?? '')]),
  ) as Record<Field, string>;
}

function ProfileForm({ clinic }: { clinic: ClinicResponse }) {
  const queryClient = useQueryClient();
  const initial = valuesOf(clinic);
  const [form, setForm] = useState(initial);
  const set = (key: Field) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, string | null> = {};
      for (const key of FIELDS) {
        if (form[key] === initial[key]) continue;
        body[key] = key === 'name' || key === 'timezone' ? form[key] : form[key].trim() || null;
      }
      return api.updateClinic(body);
    },
    onSuccess: async (updated) => {
      // Valeurs normalisées par le serveur (espaces, téléphone) : le formulaire les reprend.
      setForm(valuesOf(updated));
      queryClient.setQueryData(CLINIC_QUERY_KEY, updated);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
  });
  const changed = FIELDS.some((f) => form[f] !== initial[f]);

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
      noValidate
    >
      {save.isError && <Alert>{errorMessage(save.error)}</Alert>}
      {save.isSuccess && !changed && <Alert tone="success">Profil enregistré.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nom du cabinet"
          value={form.name}
          onChange={set('name')}
          maxLength={200}
        />
        <SelectField label="Fuseau horaire" value={form.timezone} onChange={set('timezone')}>
          {timeZones().map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Adresse"
          value={form.addressLine1}
          onChange={set('addressLine1')}
          maxLength={200}
        />
        <TextField
          label="Complément d'adresse"
          value={form.addressLine2}
          onChange={set('addressLine2')}
          maxLength={200}
        />
        <TextField
          label="Code postal"
          value={form.postalCode}
          onChange={set('postalCode')}
          maxLength={20}
        />
        <TextField label="Ville" value={form.city} onChange={set('city')} maxLength={100} />
        <TextField
          label="Téléphone"
          type="tel"
          value={form.phone}
          onChange={set('phone')}
          maxLength={32}
        />
        <TextField
          label="E-mail"
          type="email"
          value={form.email}
          onChange={set('email')}
          maxLength={254}
        />
      </div>
      {form.timezone !== initial.timezone && (
        <Alert tone="info">
          Changement de fuseau : les horaires des praticiens gardent leur heure locale (9 h reste 9
          h) et les absences en journées entières restent sur les mêmes dates. Les autres
          indisponibilités gardent leur instant.
        </Alert>
      )}
      <div>
        <Button type="submit" disabled={!changed || save.isPending || form.name.trim() === ''}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

export function ClinicProfilePage() {
  const clinic = useQuery({ queryKey: CLINIC_QUERY_KEY, queryFn: api.clinic });
  if (clinic.isPending) return <Loading />;
  if (clinic.isError) return <Alert>{errorMessage(clinic.error)}</Alert>;
  return <ProfileForm key={clinic.data.id} clinic={clinic.data} />;
}
