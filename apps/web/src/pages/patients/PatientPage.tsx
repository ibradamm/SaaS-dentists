import { RELATIONSHIPS, type PatientDetail, type Relationship } from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Loading,
  SelectField,
  TextArea,
  TextField,
} from '../../components/ui';
import { ApiError, api, errorMessage } from '../../lib/api';
import { can, useMe } from '../../lib/auth';
import { formatDate, formatDateTime, formatPhone } from '../../lib/format';
import { RELATIONSHIP_LABELS } from './labels';

const patientKey = (id: string) => ['patient', id] as const;

function useSetPatient(id: string) {
  const queryClient = useQueryClient();
  return (patient: PatientDetail) => {
    queryClient.setQueryData(patientKey(id), patient);
    void queryClient.invalidateQueries({ queryKey: ['patients'] });
  };
}

function IdentitySection({ patient, editable }: { patient: PatientDetail; editable: boolean }) {
  const setPatient = useSetPatient(patient.id);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    lastName: patient.lastName,
    firstName: patient.firstName,
    birthDate: patient.birthDate ?? '',
    email: patient.email ?? '',
    note: patient.administrativeNote ?? '',
  });
  const save = useMutation({
    mutationFn: () =>
      api.updatePatient(patient.id, {
        version: patient.version,
        lastName: form.lastName,
        firstName: form.firstName,
        birthDate: form.birthDate || null,
        email: form.email || null,
        administrativeNote: form.note || null,
      }),
    onSuccess: setPatient,
  });
  const conflict = save.error instanceof ApiError && save.error.status === 409;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4"
      noValidate
    >
      <h2 className="text-lg font-semibold">Identité et coordonnées</h2>
      {save.isError && (
        <Alert>
          {errorMessage(save.error)}
          {conflict && (
            <Button
              variant="secondary"
              className="ml-2"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: patientKey(patient.id) })
              }
            >
              Recharger la fiche
            </Button>
          )}
        </Alert>
      )}
      {save.isSuccess && <Alert tone="success">Modifications enregistrées.</Alert>}
      <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nom"
          value={form.lastName}
          onChange={(e) => setForm({ ...form, lastName: e.target.value })}
        />
        <TextField
          label="Prénom"
          value={form.firstName}
          onChange={(e) => setForm({ ...form, firstName: e.target.value })}
        />
        <TextField
          label="Date de naissance"
          type="date"
          value={form.birthDate}
          onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
        />
        <TextField
          label="E-mail"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <div className="sm:col-span-2">
          <TextArea
            label="Note administrative"
            hint="Informations pratiques uniquement. Aucune information médicale ici."
            maxLength={1000}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
      </fieldset>
      {editable && (
        <div>
          <Button type="submit" disabled={save.isPending || !form.lastName || !form.firstName}>
            Enregistrer
          </Button>
        </div>
      )}
    </form>
  );
}

function ContactsSection({ patient, editable }: { patient: PatientDetail; editable: boolean }) {
  const setPatient = useSetPatient(patient.id);
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('SELF');
  const [label, setLabel] = useState('');
  const add = useMutation({
    mutationFn: () => api.addContact(patient.id, { phone, relationship, label: label || null }),
    onSuccess: (p) => {
      setPatient(p);
      setPhone('');
      setLabel('');
    },
  });
  const makePrimary = useMutation({
    mutationFn: (contactId: string) =>
      api.updateContact(patient.id, contactId, { isPrimary: true }),
    onSuccess: setPatient,
  });
  const remove = useMutation({
    mutationFn: (contactId: string) => api.removeContact(patient.id, contactId),
    onSuccess: setPatient,
  });
  const error = add.error ?? makePrimary.error ?? remove.error;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Téléphones</h2>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {patient.contacts.length === 0 && (
        <p className="text-sm text-slate-600">Aucun numéro enregistré.</p>
      )}
      <ul className="flex flex-col gap-2">
        {patient.contacts.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{formatPhone(c.phone)}</span>
              <span className="text-sm text-slate-600">
                {RELATIONSHIP_LABELS[c.relationship]}
                {c.label ? ` · ${c.label}` : ''}
              </span>
              {c.isPrimary && <Badge tone="info">Principal</Badge>}
            </span>
            {editable && (
              <span className="flex gap-2">
                {!c.isPrimary && (
                  <Button variant="secondary" onClick={() => makePrimary.mutate(c.id)}>
                    Définir comme principal
                  </Button>
                )}
                <Button
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(`Supprimer le numéro ${formatPhone(c.phone)} ?`))
                      remove.mutate(c.id);
                  }}
                >
                  Supprimer
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
          noValidate
        >
          <TextField
            label="Nouveau numéro"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <SelectField
            label="Lien"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as Relationship)}
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Précision (facultatif)"
            placeholder="Mère, travail…"
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button type="submit" disabled={add.isPending || phone.trim().length < 3}>
            Ajouter
          </Button>
        </form>
      )}
    </section>
  );
}

function MedicalNotesSection({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  // Les notes ne sont chargées qu'à la demande : chaque lecture est tracée dans le journal d'audit.
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const queryClient = useQueryClient();
  const notes = useQuery({
    queryKey: ['medical-notes', patientId],
    queryFn: () => api.medicalNotes(patientId),
    enabled: open,
  });
  const add = useMutation({
    mutationFn: () => api.addMedicalNote(patientId, content),
    onSuccess: async () => {
      setContent('');
      await queryClient.invalidateQueries({ queryKey: ['medical-notes', patientId] });
    },
  });

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Notes médicales</h2>
      <p className="text-sm text-slate-600">
        Accès réservé au dentiste et à l&apos;administrateur. Chaque consultation est enregistrée.
      </p>
      {!open ? (
        <div>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Afficher les notes médicales
          </Button>
        </div>
      ) : (
        <>
          {notes.isPending && <Loading />}
          {notes.isError && <Alert>{errorMessage(notes.error)}</Alert>}
          {notes.data?.length === 0 && <p className="text-sm text-slate-600">Aucune note.</p>}
          <ul className="flex flex-col gap-2">
            {notes.data?.map((n) => (
              <li key={n.id} className="rounded-md bg-amber-50 px-3 py-2">
                <p className="whitespace-pre-wrap">{n.content}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {n.authorName} · {formatDateTime(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
          {canWrite && (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate();
              }}
            >
              {add.isError && <Alert>{errorMessage(add.error)}</Alert>}
              <TextArea
                label="Nouvelle note"
                hint="Une note ne peut pas être modifiée ; une correction s'ajoute comme nouvelle note."
                maxLength={5000}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <div>
                <Button type="submit" disabled={add.isPending || content.trim() === ''}>
                  Ajouter la note
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

export function PatientPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const setPatient = useSetPatient(id);
  const patient = useQuery({ queryKey: patientKey(id), queryFn: () => api.getPatient(id) });
  const toggleArchive = useMutation({
    mutationFn: (p: PatientDetail) =>
      p.status === 'ACTIVE'
        ? api.archivePatient(p.id, p.version)
        : api.restorePatient(p.id, p.version),
    onSuccess: setPatient,
  });

  if (patient.isPending) return <Loading />;
  if (patient.isError) return <Alert>{errorMessage(patient.error)}</Alert>;
  const p = patient.data;
  const editable = can(me, 'patient.write') && p.status === 'ACTIVE';

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">
            {p.lastName.toUpperCase()} {p.firstName}
          </h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            {p.birthDate && <span>Né(e) le {formatDate(p.birthDate)}</span>}
            {p.status === 'ARCHIVED' && <Badge>Archivé</Badge>}
            {p.createdSource === 'IMPORT' && (
              <Badge tone="info">Importé{p.externalRef ? ` (dossier ${p.externalRef})` : ''}</Badge>
            )}
          </p>
        </div>
        {can(me, 'patient.write') && (
          <Button
            variant={p.status === 'ACTIVE' ? 'danger' : 'secondary'}
            disabled={toggleArchive.isPending}
            onClick={() => {
              if (
                p.status === 'ACTIVE' &&
                !window.confirm(
                  'Archiver ce patient ? Il n’apparaîtra plus dans la liste des patients actifs.',
                )
              )
                return;
              toggleArchive.mutate(p);
            }}
          >
            {p.status === 'ACTIVE' ? 'Archiver' : 'Restaurer'}
          </Button>
        )}
      </div>
      {toggleArchive.isError && <Alert>{errorMessage(toggleArchive.error)}</Alert>}
      <IdentitySection key={`${p.id}-${p.version}`} patient={p} editable={editable} />
      <ContactsSection patient={p} editable={editable} />
      {can(me, 'patient.medical.read') && (
        <MedicalNotesSection patientId={p.id} canWrite={can(me, 'patient.medical.write')} />
      )}
    </section>
  );
}
