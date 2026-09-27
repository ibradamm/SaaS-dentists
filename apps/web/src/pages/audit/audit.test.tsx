import {
  AUDIT_ACTIONS,
  type AuditLogEntry,
  type AuditLogResponse,
  type Role,
} from '@dental/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDS, clinic } from '../../test/fixtures';
import { me, mockApi, renderApp, type MockCall } from '../../test/render';
import { actionGroups, describeChanges } from './format';

// Lundi 28 septembre 2026, 10 h à Paris.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T08:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const SECRETARY_ID = '01a0de00-0000-7000-8000-0000000000e1';
const APPOINTMENT_ID = '01a0de00-0000-7000-8000-0000000000f1';
const CURSOR = '01a0de00-0000-7000-8000-0000000000ff';

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: '2026-09-28T07:45:00.000Z',
    actorType: 'USER',
    actor: { id: SECRETARY_ID, name: 'Sophie Accueil' },
    action: 'appointment.status_changed',
    entityType: 'appointment',
    entityId: APPOINTMENT_ID,
    entity: { label: 'Durand Léa', patientId: IDS.patient },
    changes: { status: { from: 'SCHEDULED', to: 'CANCELLED' }, cancellationReason: {} },
    ip: '203.0.113.10',
    requestId: 'req-1',
    ...overrides,
  };
}

function setup(role: Role, pages: Record<string, AuditLogResponse> = {}) {
  return mockApi({
    'GET /api/auth/me': () => ({ status: 200, body: me(role) }),
    'GET /api/clinic': () => ({ status: 200, body: clinic() }),
    'GET /api/audit-logs/actors': () => ({
      status: 200,
      body: {
        actors: [
          { id: IDS.me, name: 'Camille Martin', role: 'ADMIN', active: true },
          { id: SECRETARY_ID, name: 'Sophie Accueil', role: 'SECRETARY', active: false },
        ],
      },
    }),
    'GET /api/audit-logs': (call) => {
      const before = new URL(call.url, 'http://x').searchParams.get('before');
      return {
        status: 200,
        body: pages[before ?? 'first'] ?? { entries: [entry()], nextCursor: null },
      };
    },
  });
}
const logCalls = (calls: MockCall[]) =>
  calls.filter((c) => c.url.startsWith('/api/audit-logs?')).map((c) => c.url);

describe('page « Journal »', () => {
  it('administrateur : 7 derniers jours, entrées lisibles dans le fuseau du cabinet', async () => {
    const calls = setup('ADMIN');
    renderApp('/journal');
    expect(await screen.findByRole('link', { name: 'Journal' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Entrées du journal' });
    expect(logCalls(calls)).toEqual(['/api/audit-logs?from=2026-09-22&to=2026-09-28']);
    const item = within(list).getByRole('listitem', { name: 'Statut de rendez-vous modifié' });
    // 07 h 45 UTC = 09 h 45 à Paris.
    expect(item).toHaveTextContent('28/09/2026 à 09:45 · Sophie Accueil');
    expect(item).toHaveTextContent('Statut : Prévu → Annulé · Motif');
    expect(item).toHaveTextContent('Adresse IP : 203.0.113.10');
    expect(within(item).getByRole('link', { name: 'Durand Léa' })).toHaveAttribute(
      'href',
      `/patients/${IDS.patient}`,
    );
    // Compte désactivé signalé dans le filtre.
    expect(screen.getByRole('option', { name: 'Sophie Accueil (désactivé)' })).toBeInTheDocument();
  });

  it('filtres : utilisateur, action, élément et période envoyés au serveur', async () => {
    const calls = setup('ADMIN');
    renderApp('/journal');
    await screen.findByRole('list', { name: 'Entrées du journal' });
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('Utilisateur'), { target: { value: SECRETARY_ID } });
    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'patient.medical_notes_read' },
    });
    fireEvent.change(screen.getByLabelText('Élément'), { target: { value: 'patient' } });
    fireEvent.click(screen.getByRole('button', { name: 'Filtrer' }));
    await waitFor(() =>
      expect(logCalls(calls)).toContain(
        `/api/audit-logs?from=2026-09-01&to=2026-09-28&actorId=${SECRETARY_ID}&action=patient.medical_notes_read&entityType=patient`,
      ),
    );
  });

  it('historique d’un élément, puis retour à tous les éléments', async () => {
    const calls = setup('ADMIN');
    renderApp('/journal');
    fireEvent.click(await screen.findByRole('button', { name: 'Historique de cet élément' }));
    await waitFor(() =>
      expect(logCalls(calls)).toContain(
        `/api/audit-logs?from=2026-09-22&to=2026-09-28&entityType=appointment&entityId=${APPOINTMENT_ID}`,
      ),
    );
    expect(await screen.findByText(/Historique d’un seul élément/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voir tous les éléments' }));
    await waitFor(() =>
      expect(logCalls(calls).at(-1)).toBe(
        '/api/audit-logs?from=2026-09-22&to=2026-09-28&entityType=appointment',
      ),
    );
  });

  it('pages suivantes au curseur, ajoutées à la liste', async () => {
    const calls = setup('ADMIN', {
      first: { entries: [entry({ action: 'auth.login_succeeded' })], nextCursor: CURSOR },
      [CURSOR]: { entries: [entry({ action: 'auth.logout' })], nextCursor: null },
    });
    renderApp('/journal');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Afficher les entrées plus anciennes' }),
    );
    expect(await screen.findByRole('listitem', { name: 'Déconnexion' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Connexion' })).toBeInTheDocument();
    expect(logCalls(calls).at(-1)).toBe(
      `/api/audit-logs?from=2026-09-22&to=2026-09-28&before=${CURSOR}`,
    );
    expect(
      screen.queryByRole('button', { name: 'Afficher les entrées plus anciennes' }),
    ).not.toBeInTheDocument();
  });

  it('période invalide : message, aucune requête', async () => {
    const calls = setup('ADMIN');
    renderApp('/journal?du=2026-09-30&au=2026-09-01');
    expect(
      await screen.findByText('La date de début doit précéder la date de fin.'),
    ).toBeInTheDocument();
    expect(logCalls(calls)).toEqual([]);
  });

  it('action du système, compte retiré, élément sans libellé (nom de patient non transmis)', async () => {
    setup('ADMIN', {
      first: {
        entries: [
          entry({ actorType: 'SYSTEM', actor: null, action: 'import.committed', entity: null }),
          entry({ actor: null, action: 'patient.updated', entityType: 'patient', entity: null }),
        ],
        nextCursor: null,
      },
    });
    renderApp('/journal');
    expect(await screen.findByRole('listitem', { name: 'Import validé' })).toHaveTextContent(
      'Système',
    );
    const updated = screen.getByRole('listitem', { name: 'Fiche patient modifiée' });
    expect(updated).toHaveTextContent('Compte retiré du cabinet');
    expect(within(updated).queryByRole('link')).not.toBeInTheDocument();
  });

  it.each(['DENTIST', 'SECRETARY'] as const)('%s : ni menu ni page', async (role) => {
    const calls = setup(role);
    renderApp('/journal');
    expect(await screen.findByText("Vous n'avez pas accès à cette page.")).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Journal' })).not.toBeInTheDocument();
    expect(logCalls(calls)).toEqual([]);
  });
});

describe('journal : mise en forme', () => {
  const context = { timeZone: 'Europe/Paris', currency: 'EUR' };

  it('chaque action du catalogue apparaît une fois dans les groupes du filtre', () => {
    const grouped = actionGroups().flatMap((g) => g.actions);
    expect([...grouped].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it('montants, instants, booléens, identifiants masqués, champ sans valeur', () => {
    expect(
      describeChanges(
        {
          amountCents: { from: 4500 },
          startAt: { from: '2026-09-28T07:00:00.000Z', to: '2026-09-28T08:30:00.000Z' },
          billingExempt: { from: false, to: true },
          practitionerId: { from: IDS.alpha, to: IDS.bravo },
          note: {},
          reasons: { to: 'OUTSIDE_WORKING_HOURS,ON_BLOCK' },
          role: { to: 'SECRETARY' },
        },
        context,
      ).map((s) => s.replace(/\s/g, ' ')),
    ).toEqual([
      'Montant : 45,00 € (avant)',
      'Début : 28/09/2026 à 09:00 → 28/09/2026 à 10:30',
      'Sans facturation : non → oui',
      'Praticien',
      'Note',
      'Dérogation : Hors des horaires du praticien, Sur un créneau bloqué',
      'Rôle : Secrétaire',
    ]);
    expect(describeChanges(null, context)).toEqual([]);
  });
});
