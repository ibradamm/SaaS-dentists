import type { MeResponse } from '@dental/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { me, mockApi, renderApp, unauthenticated } from '../test/render';

afterEach(() => vi.unstubAllGlobals());

const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('parcours de connexion', () => {
  it('sans session, toute page redirige vers la connexion', async () => {
    mockApi({ 'GET /api/auth/me': () => unauthenticated });
    renderApp('/utilisateurs');
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });

  it("affiche le message du serveur en cas d'identifiants invalides", async () => {
    mockApi({
      'GET /api/auth/me': () => unauthenticated,
      'POST /api/auth/login': () => ({
        status: 401,
        body: {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Adresse e-mail ou mot de passe incorrect',
          },
        },
      }),
    });
    renderApp('/connexion');
    await screen.findByRole('heading', { name: 'Connexion' });
    fill('Adresse e-mail', 'moi@cabinet.test');
    fill('Mot de passe', 'faux');
    fireEvent.click(await screen.findByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Adresse e-mail ou mot de passe incorrect',
    );
  });

  it('connexion secrétaire : accueil, sans accès à la gestion des utilisateurs, jeton CSRF envoyé', async () => {
    let session: MeResponse | null = null;
    const calls = mockApi({
      'GET /api/auth/me': () => (session ? { status: 200, body: session } : unauthenticated),
      'POST /api/auth/login': () => {
        session = { ...me('SECRETARY'), csrfToken: 'csrf-login' };
        return { status: 200, body: { restriction: null, csrfToken: 'csrf-login' } };
      },
      'POST /api/auth/logout': () => {
        session = null;
        return { status: 204 };
      },
    });
    renderApp('/connexion');
    await screen.findByRole('heading', { name: 'Connexion' });
    fill('Adresse e-mail', 'moi@cabinet.test');
    fill('Mot de passe', 'mot-de-passe');
    fireEvent.click(await screen.findByRole('button', { name: 'Se connecter' }));
    expect(
      await screen.findByRole('heading', { name: /Bonjour Camille Martin/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Utilisateurs' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await screen.findByRole('heading', { name: 'Connexion' });
    const logout = calls.find((c) => c.url === '/api/auth/logout');
    expect(logout?.headers['x-csrf-token']).toBe('csrf-login');
  });

  it('étape du code TOTP puis accès complet', async () => {
    let session: MeResponse = me('DENTIST', 'MFA_PENDING');
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: session }),
      'POST /api/auth/mfa/verify': () => {
        session = me('DENTIST');
        return { status: 200, body: { restriction: null, csrfToken: 'csrf-2' } };
      },
    });
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Code de vérification' }),
    ).toBeInTheDocument();
    fill('Code', '12a34 56');
    expect(screen.getByLabelText('Code')).toHaveValue('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(await screen.findByRole('heading', { name: /Bonjour/ })).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/auth/mfa/verify')?.body).toEqual({ code: '123456' });
  });

  it('mot de passe temporaire : changement imposé, confirmation vérifiée', async () => {
    let session: MeResponse = me('SECRETARY', 'PASSWORD_CHANGE_REQUIRED');
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: session }),
      'POST /api/auth/password': () => {
        session = me('SECRETARY');
        return { status: 200, body: { restriction: null, csrfToken: 'csrf-3' } };
      },
    });
    renderApp('/');
    await screen.findByRole('heading', { name: 'Choisissez votre mot de passe' });
    fill(/Mot de passe actuel/, 'temporaire');
    fill('Nouveau mot de passe', 'une phrase assez longue');
    fill('Confirmation', 'autre chose');
    expect(await screen.findByText('Les deux mots de passe diffèrent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
    fill('Confirmation', 'une phrase assez longue');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('heading', { name: /Bonjour/ })).toBeInTheDocument();
  });

  it('mise en place de la double authentification : QR code puis activation', async () => {
    let session: MeResponse = me('DENTIST', 'MFA_ENROLLMENT_REQUIRED');
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: session }),
      'POST /api/auth/mfa/setup': () => ({
        status: 200,
        body: {
          secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
          otpauthUri: 'otpauth://totp/Cabinet:moi?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        },
      }),
      'POST /api/auth/mfa/activate': () => {
        session = me('DENTIST');
        return { status: 200, body: { restriction: null, csrfToken: 'csrf-4' } };
      },
    });
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Commencer' }));
    expect(await screen.findByAltText(/QR code/)).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBeInTheDocument();
    fill("Code affiché par l'application", '654321');
    fireEvent.click(screen.getByRole('button', { name: 'Activer' }));
    expect(await screen.findByRole('heading', { name: /Bonjour/ })).toBeInTheDocument();
  });
});

describe('gestion des utilisateurs', () => {
  it("un secrétaire qui ouvre l'adresse directement voit un refus", async () => {
    mockApi({ 'GET /api/auth/me': () => ({ status: 200, body: me('SECRETARY') }) });
    renderApp('/utilisateurs');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Vous n'avez pas accès à cette page.",
    );
  });

  it('un administrateur crée un compte et voit le mot de passe temporaire une fois', async () => {
    const list = [
      {
        id: '01a0de00-0000-7000-8000-000000000001',
        email: 'moi@cabinet.test',
        fullName: 'Camille Martin',
        role: 'ADMIN',
        status: 'ACTIVE',
        mfaEnabled: true,
        lastLoginAt: null,
      },
    ];
    const calls = mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me('ADMIN') }),
      'GET /api/users': () => ({ status: 200, body: { users: list } }),
      'POST /api/users': (call) => {
        const created = {
          id: '01a0de00-0000-7000-8000-000000000002',
          email: 'nouvelle@cabinet.test',
          fullName: 'Nora Petit',
          role: 'SECRETARY',
          status: 'ACTIVE',
          mfaEnabled: false,
          lastLoginAt: null,
        };
        list.push(created);
        expect(call.body).toEqual({
          email: 'nouvelle@cabinet.test',
          fullName: 'Nora Petit',
          role: 'SECRETARY',
        });
        return { status: 201, body: { user: created, temporaryPassword: 'Abcd2345Efgh6789' } };
      },
    });
    renderApp('/utilisateurs');
    expect(await screen.findByText('(vous)')).toBeInTheDocument();
    fill('Nom complet', 'Nora Petit');
    fill('Adresse e-mail', 'nouvelle@cabinet.test');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(await screen.findByText('Abcd2345Efgh6789')).toBeInTheDocument();
    const listing = screen.getByRole('list', { name: 'Liste des utilisateurs' });
    await waitFor(() =>
      expect(within(listing).getByText('nouvelle@cabinet.test')).toBeInTheDocument(),
    );
    expect(
      calls.find((c) => c.method === 'POST' && c.url === '/api/users')?.headers['x-csrf-token'],
    ).toBe('csrf-me');
    fireEvent.click(screen.getByRole('button', { name: /J'ai transmis/ }));
    expect(screen.queryByText('Abcd2345Efgh6789')).not.toBeInTheDocument();
  });
});
