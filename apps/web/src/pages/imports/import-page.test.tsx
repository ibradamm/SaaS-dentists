import type { ImportCounts, ImportRowInput, ImportSummary } from '@dental/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { me, mockApi, renderApp, type MockCall } from '../../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BATCH_ID = '01a0de00-0000-7000-8000-00000000b001';
const admin = { 'GET /api/auth/me': () => ({ status: 200, body: me('ADMIN') }) };

const zero: ImportCounts = {
  received: 0,
  valid: 0,
  invalid: 0,
  duplicateInFile: 0,
  existing: 0,
  withWarnings: 0,
  created: 0,
  reverted: 0,
};

function batch(overrides: Partial<ImportSummary> = {}, counts: Partial<ImportCounts> = {}) {
  return {
    id: BATCH_ID,
    kind: 'PATIENTS',
    status: 'DRAFT',
    fileName: 'patients.csv',
    dateFormat: 'DD/MM/YYYY',
    totalRows: 0,
    createdAt: '2026-09-26T08:00:00.000Z',
    committedAt: null,
    revertedAt: null,
    ...overrides,
    counts: { ...zero, ...counts },
  } satisfies ImportSummary;
}

/** Fichier CSV tel qu'Excel l'enregistre en France : Windows-1252, séparateur « ; ». */
function windows1252Csv(text: string, name = 'patients.csv') {
  const bytes = Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
  return new File([bytes], name, { type: 'text/csv' });
}

function chooseFile(file: File) {
  fireEvent.change(screen.getByLabelText('Choisir le fichier'), { target: { files: [file] } });
}

const rowsOf = (call: MockCall | undefined) => (call?.body as { rows: ImportRowInput[] }).rows;

describe("assistant d'import de patients", () => {
  it('fichier Excel français → colonnes proposées → vérification → rapport → import', async () => {
    let received = 0;
    const calls = mockApi({
      ...admin,
      'GET /api/imports': () => ({ status: 200, body: { imports: [] } }),
      'POST /api/imports': () => ({ status: 201, body: batch({ totalRows: 3 }) }),
      [`POST /api/imports/${BATCH_ID}/rows`]: (call) => {
        received += rowsOf(call).length;
        return {
          status: 200,
          body: batch({ totalRows: 3 }, { received, valid: 2, invalid: 1, withWarnings: 1 }),
        };
      },
      [`GET /api/imports/${BATCH_ID}/rows`]: () => ({
        status: 200,
        body: {
          total: 2,
          rows: [
            {
              line: 3,
              status: 'VALID',
              issues: [{ field: 'phone1', code: 'INVALID_PHONE', severity: 'warning' }],
            },
            {
              line: 4,
              status: 'INVALID',
              issues: [{ field: 'lastName', code: 'REQUIRED', severity: 'error' }],
            },
          ],
        },
      }),
      [`POST /api/imports/${BATCH_ID}/commit`]: () => ({
        status: 200,
        body: batch(
          { status: 'COMMITTED', totalRows: 3, committedAt: '2026-09-26T08:05:00.000Z' },
          { received: 3, valid: 2, invalid: 1, created: 2 },
        ),
      }),
    });
    renderApp('/patients/import');
    await screen.findByRole('heading', { name: 'Importer des patients' });
    chooseFile(
      windows1252Csv(
        'Nom;Prénom;Date de naissance;Téléphone;Antécédents\r\n' +
          'Dupont;Hélène;12/03/1985;06 12 34 56 78;diabète\r\n' +
          'Martin;Léo;01/02/2003;12;\r\n' +
          ';Zoé;;;\r\n',
      ),
    );

    // Colonnes reconnues d'après les en-têtes ; la colonne médicale n'est associée à rien.
    expect(await screen.findByLabelText('Nom (obligatoire)')).toHaveValue('0');
    expect(screen.getByLabelText('Prénom (obligatoire)')).toHaveValue('1');
    expect(screen.getByLabelText('Date de naissance')).toHaveValue('2');
    expect(screen.getByLabelText('Téléphone 1')).toHaveValue('3');
    expect(screen.getByLabelText('Note administrative')).toHaveValue('');
    // Aperçu décodé correctement (Windows-1252).
    const preview = screen.getByRole('table', { name: 'Aperçu des 5 premières lignes' });
    expect(within(preview).getByText('Hélène')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Vérifier les 3 lignes' }));
    expect(await screen.findByText('Lignes à vérifier (2)')).toBeInTheDocument();
    expect(screen.getByText('Téléphone 1 : numéro invalide (valeur ignorée)')).toBeInTheDocument();
    expect(screen.getByText('Nom : obligatoire mais vide')).toBeInTheDocument();

    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/imports')?.body).toEqual({
      kind: 'PATIENTS',
      fileName: 'patients.csv',
      totalRows: 3,
      dateFormat: 'DD/MM/YYYY',
    });
    const sent = rowsOf(calls.find((c) => c.url === `/api/imports/${BATCH_ID}/rows`));
    expect(sent[0]).toEqual({
      line: 2,
      lastName: 'Dupont',
      firstName: 'Hélène',
      birthDate: '12/03/1985',
      phones: ['06 12 34 56 78'],
    });
    // La colonne non associée (« Antécédents ») n'est jamais envoyée au serveur.
    expect(JSON.stringify(sent)).not.toContain('diabète');

    fireEvent.click(screen.getByRole('button', { name: 'Importer 2 patient(s)' }));
    expect(await screen.findByText(/2 patient\(s\) importé\(s\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir les patients' })).toBeInTheDocument();
  });

  it('envoie les lignes par lots de 500 en conservant les numéros de ligne du fichier', async () => {
    let received = 0;
    const calls = mockApi({
      ...admin,
      'GET /api/imports': () => ({ status: 200, body: { imports: [] } }),
      'POST /api/imports': () => ({ status: 201, body: batch({ totalRows: 1201 }) }),
      [`POST /api/imports/${BATCH_ID}/rows`]: (call) => {
        received += rowsOf(call).length;
        return { status: 200, body: batch({ totalRows: 1201 }, { received, valid: received }) };
      },
      [`GET /api/imports/${BATCH_ID}/rows`]: () => ({ status: 200, body: { total: 0, rows: [] } }),
    });
    renderApp('/patients/import');
    await screen.findByRole('heading', { name: 'Importer des patients' });
    const lines = Array.from({ length: 1201 }, (_, i) => `Nom${i};Prenom${i}`);
    chooseFile(windows1252Csv(`Nom;Prenom\n${lines.join('\n')}\n`));
    fireEvent.click(await screen.findByRole('button', { name: /^Vérifier les 1\s201 lignes$/ }));
    expect(
      await screen.findByRole('button', { name: /^Importer 1\s201 patient\(s\)$/ }),
    ).toBeEnabled();

    const chunks = calls.filter((c) => c.url === `/api/imports/${BATCH_ID}/rows`).map(rowsOf);
    expect(chunks.map((c) => c.length)).toEqual([500, 500, 201]);
    expect(chunks[1]?.[0]).toMatchObject({ line: 502, lastName: 'Nom500' });
    expect(chunks[2]?.at(-1)).toMatchObject({ line: 1202, lastName: 'Nom1200' });
  });

  it('colonnes obligatoires non reconnues : envoi bloqué tant que l’association manque', async () => {
    mockApi({ ...admin, 'GET /api/imports': () => ({ status: 200, body: { imports: [] } }) });
    renderApp('/patients/import');
    await screen.findByRole('heading', { name: 'Importer des patients' });
    chooseFile(windows1252Csv('Colonne A;Colonne B\nDupont;Léa\n'));
    const submit = await screen.findByRole('button', { name: 'Vérifier la ligne' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Associez une colonne au champ « Nom ».')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Nom (obligatoire)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Prénom (obligatoire)'), { target: { value: '0' } });
    expect(screen.getByText('Une même colonne est associée à deux champs.')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Prénom (obligatoire)'), { target: { value: '1' } });
    expect(submit).toBeEnabled();
  });

  it('refuse les formats non pris en charge avec un message explicite', async () => {
    const calls = mockApi({
      ...admin,
      'GET /api/imports': () => ({ status: 200, body: { imports: [] } }),
    });
    renderApp('/patients/import');
    await screen.findByRole('heading', { name: 'Importer des patients' });
    chooseFile(new File(['x'], 'ancien.xls'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ancien format Excel (.xls)');
    chooseFile(new File(['x'], 'export.pdf'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Format non pris en charge'),
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('abandon après vérification : retour au choix du fichier', async () => {
    const calls = mockApi({
      ...admin,
      'GET /api/imports': () => ({ status: 200, body: { imports: [] } }),
      'POST /api/imports': () => ({ status: 201, body: batch({ totalRows: 1 }) }),
      [`POST /api/imports/${BATCH_ID}/rows`]: () => ({
        status: 200,
        body: batch({ totalRows: 1 }, { received: 1, existing: 1 }),
      }),
      [`GET /api/imports/${BATCH_ID}/rows`]: () => ({ status: 200, body: { total: 0, rows: [] } }),
      [`POST /api/imports/${BATCH_ID}/discard`]: () => ({
        status: 200,
        body: batch({ status: 'DISCARDED', totalRows: 1 }),
      }),
    });
    renderApp('/patients/import');
    await screen.findByRole('heading', { name: 'Importer des patients' });
    chooseFile(windows1252Csv('Nom;Prénom\nDupont;Léa\n'));
    fireEvent.click(await screen.findByRole('button', { name: 'Vérifier la ligne' }));
    // Aucun patient importable : le bouton d'import est désactivé.
    expect(await screen.findByRole('button', { name: 'Importer 0 patient(s)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Abandonner' }));
    expect(await screen.findByLabelText('Choisir le fichier')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/discard'))).toBe(true);
  });

  it("annulation d'un import validé depuis l'historique, après confirmation", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    let status: ImportSummary['status'] = 'COMMITTED';
    const calls = mockApi({
      ...admin,
      'GET /api/imports': () => ({
        status: 200,
        body: {
          imports: [
            batch(
              { status, fileName: 'export-2025.csv', totalRows: 3 },
              { created: 3, reverted: status === 'REVERTED' ? 2 : 0 },
            ),
          ],
        },
      }),
      [`POST /api/imports/${BATCH_ID}/revert`]: () => {
        status = 'REVERTED';
        return {
          status: 200,
          body: { summary: batch({ status: 'REVERTED' }), deleted: 2, kept: 1 },
        };
      },
    });
    renderApp('/patients/import');
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler cet import' }));
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "2 patient(s) supprimé(s). 1 patient(s) modifié(s) depuis l'import ont été conservés.",
      ),
    );
    expect(await screen.findByText(/Annulé · 2 supprimé\(s\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Annuler cet import' })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith('/revert'))).toHaveLength(1);
  });
});
