import {
  DATE_FORMATS,
  IMPORT_LIMITS,
  PATIENT_IMPORT_FIELDS,
  type DateFormat,
  type ImportSummary,
} from '@dental/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Loading, SelectField } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/format-date';
import {
  FIELD_LABELS,
  mapRows,
  mappingErrors,
  suggestMapping,
  type Mapping,
} from '../../lib/import/mapping';
import { readTabularFile } from '../../lib/import/read-file';
import { FileReadError, type Table } from '../../lib/import/table';
import { BATCH_STATUS_LABELS, ROW_STATUS_LABELS, issueText } from './labels';

type Step = 'file' | 'mapping' | 'report' | 'done';

function FileStep({ onRead }: { onRead: (file: File, table: Table) => void }) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function read(file: File) {
    setError(null);
    setReading(true);
    try {
      onRead(file, await readTabularFile(file));
    } catch (err) {
      // Seuls nos messages sont affichés, jamais un détail technique de bibliothèque.
      setError(err instanceof FileReadError ? err.message : 'Fichier illisible.');
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-700">
        Fichier <strong>.csv</strong> ou <strong>.xlsx</strong> (Excel), avec une ligne
        d&apos;en-têtes, jusqu&apos;à {IMPORT_LIMITS.maxRows.toLocaleString('fr-FR')} patients et 10
        Mo. Le fichier est lu sur cet ordinateur ; seules les colonnes que vous associez sont
        envoyées au serveur. Les informations médicales ne sont pas importées.
      </p>
      {error && <Alert>{error}</Alert>}
      <label htmlFor={id} className="text-sm font-medium">
        Choisir le fichier
      </label>
      <input
        id={id}
        type="file"
        accept=".csv,.txt,.xlsx"
        disabled={reading}
        className="block text-sm file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-sky-700 file:px-4 file:text-white"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Permet de choisir à nouveau le même fichier après une erreur.
          e.target.value = '';
          if (file) void read(file);
        }}
      />
      {reading && <Loading label="Lecture du fichier…" />}
    </div>
  );
}

function MappingStep(props: {
  file: File;
  table: Table;
  mapping: Mapping;
  dateFormat: DateFormat;
  onChange: (mapping: Mapping, dateFormat: DateFormat) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  progress: number;
  error: unknown;
}) {
  const { table, mapping, dateFormat } = props;
  const errors = mappingErrors(mapping);
  const preview = mapRows({ ...table, rows: table.rows.slice(0, 5) }, mapping);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-700">
        <strong>{props.file.name}</strong> : {table.rows.length.toLocaleString('fr-FR')} ligne(s),{' '}
        {table.headers.length} colonne(s). Indiquez la colonne correspondant à chaque information.
        Les colonnes non associées sont ignorées.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PATIENT_IMPORT_FIELDS.map((field) => (
          <SelectField
            key={field}
            label={`${FIELD_LABELS[field]}${field === 'lastName' || field === 'firstName' ? ' (obligatoire)' : ''}`}
            value={mapping[field] ?? ''}
            disabled={props.busy}
            onChange={(e) =>
              props.onChange(
                { ...mapping, [field]: e.target.value === '' ? null : Number(e.target.value) },
                dateFormat,
              )
            }
          >
            <option value="">— Ne pas importer —</option>
            {table.headers.map((h, i) => (
              <option key={i} value={i}>
                {h}
              </option>
            ))}
          </SelectField>
        ))}
        <SelectField
          label="Format des dates dans le fichier"
          value={dateFormat}
          disabled={props.busy}
          onChange={(e) => props.onChange(mapping, e.target.value as DateFormat)}
        >
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f === 'DD/MM/YYYY'
                ? 'JJ/MM/AAAA'
                : f === 'MM/DD/YYYY'
                  ? 'MM/JJ/AAAA (américain)'
                  : 'AAAA-MM-JJ'}
            </option>
          ))}
        </SelectField>
      </div>
      {errors.length > 0 && (
        <Alert>
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </Alert>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <caption className="mb-2 text-left font-medium">Aperçu des 5 premières lignes</caption>
          <thead>
            <tr className="border-b border-slate-200">
              <th className="p-2">Ligne</th>
              <th className="p-2">Nom</th>
              <th className="p-2">Prénom</th>
              <th className="p-2">Naissance</th>
              <th className="p-2">Téléphones</th>
              <th className="p-2">E-mail</th>
            </tr>
          </thead>
          <tbody>
            {preview.map((r) => (
              <tr key={r.line} className="border-b border-slate-100">
                <td className="p-2">{r.line}</td>
                <td className="p-2">{r.lastName}</td>
                <td className="p-2">{r.firstName}</td>
                <td className="p-2">{r.birthDate}</td>
                <td className="p-2">{r.phones?.join(', ')}</td>
                <td className="p-2">{r.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.error !== null && props.error !== undefined && (
        <Alert>{errorMessage(props.error)}</Alert>
      )}
      {props.busy && (
        <div className="flex flex-col gap-1">
          <label className="text-sm" htmlFor="import-progress">
            Vérification en cours…
          </label>
          <progress
            id="import-progress"
            className="w-full"
            max={table.rows.length}
            value={props.progress}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={props.onSubmit} disabled={errors.length > 0 || props.busy}>
          {table.rows.length === 1
            ? 'Vérifier la ligne'
            : `Vérifier les ${table.rows.length.toLocaleString('fr-FR')} lignes`}
        </Button>
        <Button variant="secondary" onClick={props.onCancel} disabled={props.busy}>
          Choisir un autre fichier
        </Button>
      </div>
    </div>
  );
}

function ReportStep({
  batch,
  onCommitted,
  onDiscarded,
}: {
  batch: ImportSummary;
  onCommitted: (b: ImportSummary) => void;
  onDiscarded: () => void;
}) {
  const report = useQuery({
    queryKey: ['import-report', batch.id],
    queryFn: () => api.importReport(batch.id),
  });
  const commit = useMutation({
    mutationFn: () => api.commitImport(batch.id),
    onSuccess: onCommitted,
  });
  const discard = useMutation({
    mutationFn: () => api.discardImport(batch.id),
    onSuccess: onDiscarded,
  });
  const c = batch.counts;
  const stats: [string, number][] = [
    ['Patients importables', c.valid],
    ['Dont avec avertissement', c.withWarnings],
    ['Lignes refusées', c.invalid],
    ['Doublons dans le fichier', c.duplicateInFile],
    ['Déjà enregistrés (ignorés)', c.existing],
  ];
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-2 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-md bg-slate-50 p-3">
            <dt className="text-xs text-slate-600">{label}</dt>
            <dd className="text-xl font-semibold">{value.toLocaleString('fr-FR')}</dd>
          </div>
        ))}
      </dl>
      {report.isPending && <Loading />}
      {report.data && report.data.total > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <caption className="mb-2 text-left font-medium">
              Lignes à vérifier ({report.data.total.toLocaleString('fr-FR')}
              {report.data.total > report.data.rows.length
                ? `, ${report.data.rows.length} premières affichées`
                : ''}
              )
            </caption>
            <thead>
              <tr className="border-b border-slate-200">
                <th className="p-2">Ligne du fichier</th>
                <th className="p-2">Résultat</th>
                <th className="p-2">Détail</th>
              </tr>
            </thead>
            <tbody>
              {report.data.rows.map((r) => (
                <tr key={r.line} className="border-b border-slate-100 align-top">
                  <td className="p-2">{r.line}</td>
                  <td className="p-2">{ROW_STATUS_LABELS[r.status]}</td>
                  <td className="p-2">{r.issues.map(issueText).join(' ; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(commit.error ?? discard.error) && (
        <Alert>{errorMessage(commit.error ?? discard.error)}</Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => commit.mutate()}
          disabled={c.valid === 0 || commit.isPending || discard.isPending}
        >
          Importer {c.valid.toLocaleString('fr-FR')} patient(s)
        </Button>
        <Button
          variant="secondary"
          onClick={() => discard.mutate()}
          disabled={commit.isPending || discard.isPending}
        >
          Abandonner
        </Button>
      </div>
    </div>
  );
}

function History() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['imports'], queryFn: api.listImports });
  const revert = useMutation({
    mutationFn: api.revertImport,
    onSuccess: async (res) => {
      window.alert(
        `${res.deleted} patient(s) supprimé(s).` +
          (res.kept > 0
            ? ` ${res.kept} patient(s) modifié(s) depuis l'import ont été conservés.`
            : ''),
      );
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
      await queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
  if (!list.data || list.data.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Imports récents</h2>
      {revert.isError && <Alert>{errorMessage(revert.error)}</Alert>}
      <ul className="flex flex-col gap-2">
        {list.data.map((b) => (
          <li
            key={b.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <span>
              <strong>{b.fileName}</strong> · {formatDateTime(b.createdAt)} ·{' '}
              {BATCH_STATUS_LABELS[b.status]}
              {b.status === 'COMMITTED' && ` · ${b.counts.created} patient(s) créé(s)`}
              {b.status === 'REVERTED' && ` · ${b.counts.reverted} supprimé(s)`}
            </span>
            {b.status === 'COMMITTED' && (
              <Button
                variant="danger"
                disabled={revert.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Annuler l'import « ${b.fileName} » ? Les patients importés et non modifiés depuis seront supprimés.`,
                    )
                  ) {
                    revert.mutate(b.id);
                  }
                }}
              >
                Annuler cet import
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ImportPage() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat>('DD/MM/YYYY');
  const [batch, setBatch] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState(0);

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !table || !mapping) throw new Error('Fichier manquant');
      const rows = mapRows(table, mapping);
      let summary = await api.createImport({
        kind: 'PATIENTS',
        fileName: file.name.slice(0, 255),
        totalRows: rows.length,
        dateFormat,
      });
      setBatch(summary);
      for (let i = 0; i < rows.length; i += IMPORT_LIMITS.chunkSize) {
        summary = await api.sendImportRows(summary.id, rows.slice(i, i + IMPORT_LIMITS.chunkSize));
        setProgress(summary.counts.received);
      }
      return summary;
    },
    onSuccess: (summary) => {
      setBatch(summary);
      setStep('report');
    },
  });

  function reset() {
    setStep('file');
    setFile(null);
    setTable(null);
    setMapping(null);
    setBatch(null);
    setProgress(0);
    upload.reset();
    void queryClient.invalidateQueries({ queryKey: ['imports'] });
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Importer des patients</h1>
        <Link to="/patients" className="text-sm underline">
          Retour aux patients
        </Link>
      </div>
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Étapes">
        {(['file', 'mapping', 'report', 'done'] as const).map((s, i) => (
          <li
            key={s}
            aria-current={step === s ? 'step' : undefined}
            className={`rounded px-2 py-1 ${step === s ? 'bg-sky-100 font-medium text-sky-900' : 'text-slate-600'}`}
          >
            {i + 1}. {['Fichier', 'Colonnes', 'Vérification', 'Terminé'][i]}
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        {step === 'file' && (
          <FileStep
            onRead={(f, t) => {
              setFile(f);
              setTable(t);
              setMapping(suggestMapping(t.headers));
              setStep('mapping');
            }}
          />
        )}
        {step === 'mapping' && file && table && mapping && (
          <MappingStep
            file={file}
            table={table}
            mapping={mapping}
            dateFormat={dateFormat}
            onChange={(m, d) => {
              setMapping(m);
              setDateFormat(d);
            }}
            onSubmit={() => upload.mutate()}
            onCancel={reset}
            busy={upload.isPending}
            progress={progress}
            error={upload.error}
          />
        )}
        {step === 'report' && batch && (
          <ReportStep
            batch={batch}
            onCommitted={(b) => {
              setBatch(b);
              setStep('done');
              void queryClient.invalidateQueries({ queryKey: ['patients'] });
              void queryClient.invalidateQueries({ queryKey: ['imports'] });
            }}
            onDiscarded={reset}
          />
        )}
        {step === 'done' && batch && (
          <div className="flex flex-col gap-3">
            <Alert tone="success">
              {batch.counts.created.toLocaleString('fr-FR')} patient(s) importé(s)
              {batch.counts.existing > 0
                ? `, ${batch.counts.existing} déjà enregistré(s) ignoré(s)`
                : ''}
              . Cet import peut être annulé depuis la liste ci-dessous tant que les patients
              n&apos;ont pas été modifiés.
            </Alert>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/patients"
                className="inline-flex min-h-11 items-center rounded-md bg-sky-700 px-4 text-sm font-medium text-white"
              >
                Voir les patients
              </Link>
              <Button variant="secondary" onClick={reset}>
                Importer un autre fichier
              </Button>
            </div>
          </div>
        )}
      </div>
      <History />
    </section>
  );
}
