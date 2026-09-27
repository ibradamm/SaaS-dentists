import type { PatientSummary } from '@dental/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Alert, Button, TextArea, TextField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/format-date';

export function NewPatientPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    lastName: '',
    firstName: '',
    birthDate: '',
    phone: '',
    email: '',
    note: '',
  });
  const [duplicates, setDuplicates] = useState<PatientSummary[] | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value });

  const create = useMutation({
    mutationFn: () =>
      api.createPatient({
        lastName: form.lastName,
        firstName: form.firstName,
        birthDate: form.birthDate || null,
        email: form.email || null,
        administrativeNote: form.note || null,
        contacts: form.phone ? [{ phone: form.phone }] : [],
      }),
    onSuccess: (patient) => navigate(`/patients/${patient.id}`, { replace: true }),
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

  function submit(event: FormEvent) {
    event.preventDefault();
    // Recherche de doublons avant la création : la personne décide en connaissance de cause.
    if (duplicates) create.mutate();
    else check.mutate();
  }

  const error = create.error ?? check.error;
  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Nouveau patient</h1>
      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
        noValidate
      >
        {error && <Alert>{errorMessage(error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nom"
            required
            value={form.lastName}
            onChange={(e) => {
              setDuplicates(null);
              set('lastName')(e);
            }}
          />
          <TextField
            label="Prénom"
            required
            value={form.firstName}
            onChange={(e) => {
              setDuplicates(null);
              set('firstName')(e);
            }}
          />
          <TextField
            label="Date de naissance"
            type="date"
            value={form.birthDate}
            onChange={(e) => {
              setDuplicates(null);
              set('birthDate')(e);
            }}
          />
          <TextField
            label="Téléphone"
            type="tel"
            autoComplete="off"
            value={form.phone}
            onChange={set('phone')}
          />
          <TextField
            label="E-mail"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={set('email')}
          />
        </div>
        <TextArea
          label="Note administrative"
          hint="Informations pratiques uniquement (préférences, disponibilités). Aucune information médicale ici."
          maxLength={1000}
          value={form.note}
          onChange={set('note')}
        />
        {duplicates && (
          <Alert tone="info">
            <p className="mb-2">Patient(s) similaire(s) déjà enregistré(s) :</p>
            <ul className="mb-2 list-disc pl-5">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <Link className="underline" to={`/patients/${d.id}`}>
                    {d.lastName.toUpperCase()} {d.firstName}
                    {d.birthDate ? `, né(e) le ${formatDate(d.birthDate)}` : ''}
                  </Link>
                </li>
              ))}
            </ul>
            <p>
              Vérifiez qu&apos;il ne s&apos;agit pas de la même personne avant de créer une nouvelle
              fiche.
            </p>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={create.isPending || check.isPending || !form.lastName || !form.firstName}
          >
            {duplicates ? 'Créer quand même' : 'Créer la fiche'}
          </Button>
          <Button variant="secondary" onClick={() => void navigate('/patients')}>
            Annuler
          </Button>
        </div>
      </form>
    </section>
  );
}
