import type { Appointment, PatientDetail, PatientSummary, Role } from '@dental/shared';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { me, mockApi, renderApp } from '../../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

const PATIENT_ID = '01a0de00-0000-7000-8000-00000000a001';
const OTHER_ID = '01a0de00-0000-7000-8000-00000000a002';

const summary: PatientSummary = {
  id: PATIENT_ID,
  lastName: 'Dupont',
  firstName: 'Léa',
  birthDate: '1985-03-12',
  primaryPhone: '+33612345678',
  status: 'ACTIVE',
};

function detail(overrides: Partial<PatientDetail> = {}): PatientDetail {
  return {
    ...summary,
    email: null,
    administrativeNote: null,
    createdSource: 'STAFF',
    externalRef: null,
    version: 3,
    contacts: [
      {
        id: '01a0de00-0000-7000-8000-00000000c001',
        phone: '+33612345678',
        relationship: 'SELF',
        label: null,
        isPrimary: true,
      },
    ],
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

const CLINIC = {
  id: '01a0de00-0000-7000-8000-0000000000c1',
  name: 'Cabinet du Parc',
  timezone: 'Europe/Paris',
  locale: 'fr-FR',
  currency: 'EUR',
  countryCode: 'FR',
  addressLine1: null,
  addressLine2: null,
  postalCode: null,
  city: null,
  phone: null,
  email: null,
};

// Session, plus ce que la section « Rendez-vous » de la fiche charge (aucun rendez-vous).
const session = (role: Role, appointments: Appointment[] = []) => ({
  'GET /api/auth/me': () => ({ status: 200, body: me(role) }),
  'GET /api/clinic': () => ({ status: 200, body: CLINIC }),
  'GET /api/practitioners': () => ({ status: 200, body: { practitioners: [] } }),
  [`GET /api/patients/${PATIENT_ID}/appointments`]: () => ({
    status: 200,
    body: { appointments },
  }),
});

describe('liste des patients', () => {
  it('affiche la liste, recherche côté serveur et masque les actions non autorisées', async () => {
    const calls = mockApi({
      ...session('SECRETARY'),
      'GET /api/patients': () => ({ status: 200, body: { patients: [summary], total: 1 } }),
    });
    renderApp('/patients');
    const list = await screen.findByRole('list', { name: 'Liste des patients' });
    expect(within(list).getByText('DUPONT Léa')).toBeInTheDocument();
    expect(within(list).getByText('Né(e) le 12/03/1985')).toBeInTheDocument();
    expect(within(list).getByText('06 12 34 56 78')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Nouveau patient' })).toBeInTheDocument();
    // L'import est réservé à l'administrateur.
    expect(screen.queryByRole('link', { name: 'Importer un fichier' })).not.toBeInTheDocument();

    fill(/Rechercher \(nom/, ' dup ');
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/api/patients?') && c.url.includes('q=dup'))).toBe(
        true,
      ),
    );
    expect(calls[calls.length - 1]?.url).toBe(
      '/api/patients?q=dup&status=ACTIVE&limit=25&offset=0',
    );
  });

  it("l'administrateur voit le lien d'import", async () => {
    mockApi({
      ...session('ADMIN'),
      'GET /api/patients': () => ({ status: 200, body: { patients: [], total: 0 } }),
    });
    renderApp('/patients');
    expect(await screen.findByText('Aucun patient trouvé.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Importer un fichier' })).toBeInTheDocument();
  });

  it("l'import est refusé au dentiste et à la secrétaire, sans appel à l'API patients", async () => {
    for (const role of ['DENTIST', 'SECRETARY'] as const) {
      const calls = mockApi({
        ...session(role),
        'GET /api/patients': () => ({ status: 200, body: { patients: [summary], total: 1 } }),
      });
      const router = renderApp('/patients');
      await screen.findByRole('list', { name: 'Liste des patients' });
      expect(screen.getByRole('link', { name: 'Nouveau patient' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Importer un fichier' })).not.toBeInTheDocument();
      // /patients/import ne doit pas être interprété comme la fiche du patient « import ».
      await router.navigate('/patients/import');
      expect(await screen.findByText("Vous n'avez pas accès à cette page.")).toBeInTheDocument();
      expect(calls.some((c) => c.url.startsWith('/api/patients/import'))).toBe(false);
      cleanup();
      vi.unstubAllGlobals();
    }
  });
});

describe('création de fiche', () => {
  it('signale les homonymes avant de créer, puis crée sur confirmation', async () => {
    const created = detail({ id: OTHER_ID, version: 1, birthDate: null, primaryPhone: null });
    const calls = mockApi({
      ...session('SECRETARY'),
      'GET /api/patients/duplicates': () => ({ status: 200, body: { candidates: [summary] } }),
      'POST /api/patients': () => ({ status: 201, body: created }),
      [`GET /api/patients/${OTHER_ID}`]: () => ({ status: 200, body: created }),
    });
    renderApp('/patients/nouveau');
    await screen.findByRole('heading', { name: 'Nouveau patient' });
    expect(screen.getByRole('button', { name: 'Créer la fiche' })).toBeDisabled();
    fill('Nom', 'Dupont');
    fill('Prénom', 'Léa');
    fill('Téléphone', '06 12 34 56 78');
    fireEvent.click(screen.getByRole('button', { name: 'Créer la fiche' }));

    expect(
      await screen.findByText('Patient(s) similaire(s) déjà enregistré(s) :'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /DUPONT Léa, né\(e\) le 12\/03\/1985/ }),
    ).toHaveAttribute('href', `/patients/${PATIENT_ID}`);
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/patients')).toBeUndefined();
    expect(calls.find((c) => c.url.startsWith('/api/patients/duplicates'))?.url).toBe(
      '/api/patients/duplicates?lastName=Dupont&firstName=L%C3%A9a',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Créer quand même' }));
    expect(await screen.findByRole('heading', { name: 'DUPONT Léa' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/patients')?.body).toEqual({
      lastName: 'Dupont',
      firstName: 'Léa',
      birthDate: null,
      email: null,
      administrativeNote: null,
      contacts: [{ phone: '06 12 34 56 78' }],
    });
  });

  it("modifier le nom après l'alerte relance la recherche de doublons", async () => {
    const calls = mockApi({
      ...session('SECRETARY'),
      'GET /api/patients/duplicates': () => ({ status: 200, body: { candidates: [summary] } }),
    });
    renderApp('/patients/nouveau');
    await screen.findByRole('heading', { name: 'Nouveau patient' });
    fill('Nom', 'Dupont');
    fill('Prénom', 'Léa');
    fireEvent.click(screen.getByRole('button', { name: 'Créer la fiche' }));
    await screen.findByRole('button', { name: 'Créer quand même' });
    fill('Prénom', 'Lea');
    expect(screen.getByRole('button', { name: 'Créer la fiche' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Créer la fiche' }));
    await screen.findByRole('button', { name: 'Créer quand même' });
    expect(calls.filter((c) => c.url.startsWith('/api/patients/duplicates'))).toHaveLength(2);
    expect(calls.find((c) => c.method === 'POST')).toBeUndefined();
  });
});

describe('fiche patient', () => {
  it("la secrétaire modifie l'identité, sans accès aux notes médicales", async () => {
    let current = detail();
    const calls = mockApi({
      ...session('SECRETARY'),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({ status: 200, body: current }),
      [`PATCH /api/patients/${PATIENT_ID}`]: () => {
        current = { ...current, email: 'lea@exemple.test', version: 4 };
        return { status: 200, body: current };
      },
    });
    renderApp(`/patients/${PATIENT_ID}`);
    await screen.findByRole('heading', { name: 'DUPONT Léa' });
    expect(screen.queryByRole('heading', { name: 'Notes médicales' })).not.toBeInTheDocument();
    expect(screen.getByText('Principal')).toBeInTheDocument();

    fill('E-mail', 'lea@exemple.test');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveValue('lea@exemple.test'));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      version: 3,
      lastName: 'Dupont',
      firstName: 'Léa',
      birthDate: '1985-03-12',
      email: 'lea@exemple.test',
      administrativeNote: null,
    });
    expect(calls.some((c) => c.url.includes('medical-notes'))).toBe(false);
  });

  it('conflit de version : message du serveur et rechargement proposé', async () => {
    let loads = 0;
    mockApi({
      ...session('SECRETARY'),
      [`GET /api/patients/${PATIENT_ID}`]: () => {
        loads += 1;
        return { status: 200, body: detail({ version: 2 + loads }) };
      },
      [`PATCH /api/patients/${PATIENT_ID}`]: () => ({
        status: 409,
        body: {
          error: {
            code: 'CONFLICT',
            message: 'La fiche a été modifiée entre-temps. Rechargez-la avant de réessayer.',
          },
        },
      }),
    });
    renderApp(`/patients/${PATIENT_ID}`);
    await screen.findByRole('heading', { name: 'DUPONT Léa' });
    fill('Prénom', 'Léna');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La fiche a été modifiée entre-temps',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Recharger la fiche' }));
    // Nouvelle version reçue : le formulaire est réinitialisé avec les données du serveur.
    await waitFor(() => expect(screen.getByLabelText('Prénom')).toHaveValue('Léa'));
    expect(loads).toBe(2);
  });

  it("le dentiste n'ouvre les notes médicales qu'à la demande, puis en ajoute une", async () => {
    const notes = [
      {
        id: '01a0de00-0000-7000-8000-00000000e001',
        content: 'Allergie à la pénicilline',
        authorName: 'Dr Martin',
        createdAt: '2026-09-02T09:30:00.000Z',
      },
    ];
    const calls = mockApi({
      ...session('DENTIST'),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({ status: 200, body: detail() }),
      [`GET /api/patients/${PATIENT_ID}/medical-notes`]: () => ({ status: 200, body: { notes } }),
      [`POST /api/patients/${PATIENT_ID}/medical-notes`]: (call) => {
        notes.push({
          id: '01a0de00-0000-7000-8000-00000000e002',
          content: (call.body as { content: string }).content,
          authorName: 'Dr Martin',
          createdAt: '2026-09-03T09:30:00.000Z',
        });
        return { status: 204 };
      },
    });
    renderApp(`/patients/${PATIENT_ID}`);
    await screen.findByRole('heading', { name: 'Notes médicales' });
    expect(calls.some((c) => c.url.includes('medical-notes'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Afficher les notes médicales' }));
    expect(await screen.findByText('Allergie à la pénicilline')).toBeInTheDocument();
    fill('Nouvelle note', 'Contrôle dans 6 mois');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la note' }));
    expect(await screen.findByText('Contrôle dans 6 mois')).toBeInTheDocument();
    expect(
      calls.filter((c) => c.url.endsWith('/medical-notes') && c.method === 'GET'),
    ).toHaveLength(2);
  });

  it('archivage confirmé : la fiche passe en lecture seule et peut être restaurée', async () => {
    let current = detail({ createdSource: 'IMPORT', externalRef: 'D-042' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = mockApi({
      ...session('ADMIN'),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({ status: 200, body: current }),
      [`POST /api/patients/${PATIENT_ID}/archive`]: () => {
        current = { ...current, status: 'ARCHIVED', version: current.version + 1 };
        return { status: 200, body: current };
      },
    });
    renderApp(`/patients/${PATIENT_ID}`);
    await screen.findByText('Importé (dossier D-042)');
    fireEvent.click(screen.getByRole('button', { name: 'Archiver' }));
    expect(await screen.findByRole('button', { name: 'Restaurer' })).toBeInTheDocument();
    expect(screen.getByText('Archivé')).toBeInTheDocument();
    expect(screen.getByLabelText('Nom')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).not.toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/archive'))?.body).toEqual({ version: 3 });
  });

  it("archivage annulé dans la boîte de confirmation : aucun appel à l'API", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const calls = mockApi({
      ...session('SECRETARY'),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({ status: 200, body: detail() }),
    });
    renderApp(`/patients/${PATIENT_ID}`);
    await screen.findByRole('heading', { name: 'DUPONT Léa' });
    fireEvent.click(screen.getByRole('button', { name: 'Archiver' }));
    expect(calls.some((c) => c.url.endsWith('/archive'))).toBe(false);
  });

  it('ajout d’un numéro : envoi du lien et de la précision, erreur du serveur affichée', async () => {
    const calls = mockApi({
      ...session('SECRETARY'),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({ status: 200, body: detail() }),
      [`POST /api/patients/${PATIENT_ID}/contacts`]: () => ({
        status: 400,
        body: { error: { code: 'VALIDATION_FAILED', message: 'Numéro de téléphone invalide' } },
      }),
    });
    renderApp(`/patients/${PATIENT_ID}`);
    await screen.findByRole('heading', { name: 'Téléphones' });
    fill('Nouveau numéro', '0123');
    fill('Lien', 'GUARDIAN');
    fill('Précision (facultatif)', 'Mère');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Numéro de téléphone invalide');
    expect(calls.find((c) => c.url.endsWith('/contacts'))?.body).toEqual({
      phone: '0123',
      relationship: 'GUARDIAN',
      label: 'Mère',
    });
  });
});

describe('rendez-vous du patient', () => {
  const appointment = (overrides: Partial<Appointment>): Appointment => ({
    id: '01a0de00-0000-7000-8000-00000000f001',
    practitionerId: '01a0de00-0000-7000-8000-0000000000a1',
    patient: { id: PATIENT_ID, lastName: 'Dupont', firstName: 'Léa', primaryPhone: null },
    appointmentType: {
      id: '01a0de00-0000-7000-8000-0000000000d1',
      name: 'Consultation',
      color: '#10b981',
    },
    startAt: '2026-10-05T07:00:00.000Z',
    endAt: '2026-10-05T07:30:00.000Z',
    durationMinutes: 30,
    status: 'SCHEDULED',
    note: null,
    cancellationReason: null,
    version: 1,
    ...overrides,
  });

  afterEach(() => vi.useRealTimers());

  it('à venir et historique séparés, en heure du cabinet ; lien de prise de rendez-vous', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
    mockApi({
      ...session('SECRETARY', [
        // Réponse du serveur : du plus récent au plus ancien.
        appointment({
          id: '01a0de00-0000-7000-8000-00000000f003',
          startAt: '2026-10-12T07:00:00.000Z',
          endAt: '2026-10-12T07:30:00.000Z',
        }),
        appointment({}),
        appointment({
          id: '01a0de00-0000-7000-8000-00000000f002',
          startAt: '2026-09-21T12:00:00.000Z',
          endAt: '2026-09-21T12:30:00.000Z',
          status: 'NO_SHOW',
        }),
      ]),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({ status: 200, body: detail() }),
    });
    renderApp(`/patients/${PATIENT_ID}`);
    const upcoming = await screen.findByRole('list', { name: 'Rendez-vous à venir' });
    expect(
      within(upcoming)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['lundi 5 octobre 2026 à 09:00', 'lundi 12 octobre 2026 à 09:00']);
    const history = screen.getByRole('list', { name: 'Historique des rendez-vous' });
    expect(within(history).getByText('Patient absent')).toBeInTheDocument();
    expect(within(history).getByRole('link')).toHaveAttribute(
      'href',
      '/agenda?date=2026-09-21&rdv=01a0de00-0000-7000-8000-00000000f002',
    );
    expect(screen.getByRole('link', { name: 'Prendre rendez-vous' })).toHaveAttribute(
      'href',
      `/agenda?nouveau=1&patient=${PATIENT_ID}`,
    );
  });

  it('résumé en tête : téléphone cliquable, âge, prochain rendez-vous', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
    mockApi({
      ...session('SECRETARY', [
        appointment({
          id: '01a0de00-0000-7000-8000-00000000f003',
          startAt: '2026-10-12T07:00:00.000Z',
          endAt: '2026-10-12T07:30:00.000Z',
        }),
        appointment({}),
      ]),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({ status: 200, body: detail() }),
    });
    renderApp(`/patients/${PATIENT_ID}`);
    const phone = await screen.findByRole('link', { name: '06 12 34 56 78' });
    expect(phone).toHaveAttribute('href', 'tel:+33612345678');
    expect(await screen.findByText('12/03/1985 (41 ans)')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'lundi 5 octobre à 09:00' })).toHaveAttribute(
      'href',
      '/agenda?date=2026-10-05&rdv=01a0de00-0000-7000-8000-00000000f001',
    );
  });

  it('ordre des sections selon le rôle : notes médicales en premier pour le dentiste', async () => {
    const order = () =>
      screen
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent)
        .filter((t) => t !== null);
    mockApi({
      ...session('DENTIST'),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({ status: 200, body: detail() }),
      [`GET /api/patients/${PATIENT_ID}/medical-notes`]: () => ({
        status: 200,
        body: { notes: [] },
      }),
    });
    renderApp(`/patients/${PATIENT_ID}`);
    await screen.findByRole('heading', { name: 'Notes médicales' });
    expect(order()).toEqual([
      'Notes médicales',
      'Rendez-vous',
      'Identité et coordonnées',
      'Téléphones',
    ]);
  });

  it('patient archivé : historique visible, pas de prise de rendez-vous', async () => {
    mockApi({
      ...session('SECRETARY'),
      [`GET /api/patients/${PATIENT_ID}`]: () => ({
        status: 200,
        body: detail({ status: 'ARCHIVED' }),
      }),
    });
    renderApp(`/patients/${PATIENT_ID}`);
    expect(await screen.findByText('Aucun rendez-vous à venir.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Prendre rendez-vous' })).toBeNull();
  });
});
