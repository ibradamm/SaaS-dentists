import type { ClinicUser, Practitioner } from '@dental/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { me, mockApi, renderApp } from '../../test/render';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ME_ID = '01a0de00-0000-7000-8000-000000000001';
const DENTIST_ID = '01a0de00-0000-7000-8000-00000000d001';
const OTHER_ID = '01a0de00-0000-7000-8000-00000000d002';

const user = (id: string, fullName: string, role: ClinicUser['role']): ClinicUser => ({
  id,
  email: `${fullName.split(' ')[0]!.toLowerCase()}@cabinet.test`,
  fullName,
  role,
  status: 'ACTIVE',
  mfaEnabled: true,
  lastLoginAt: null,
});
const users = [
  user(ME_ID, 'Camille Martin', 'ADMIN'),
  user(DENTIST_ID, 'Léo Durand', 'DENTIST'),
  user(OTHER_ID, 'Inès Moreau', 'DENTIST'),
];
const linked: Practitioner = {
  id: '01a0de00-0000-7000-8000-0000000000a1',
  displayName: 'Dr Durand',
  color: '#10b981',
  userId: DENTIST_ID,
  userFullName: 'Léo Durand',
  status: 'ACTIVE',
  version: 1,
};
const clinic = {
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
  phone: '+33145678910',
  email: null,
};

const admin = { 'GET /api/auth/me': () => ({ status: 200, body: me('ADMIN') }) };

describe('paramètres du cabinet', () => {
  it('réservés à l’administrateur : ni menu ni accès pour la secrétaire', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 200, body: me('SECRETARY') }),
      'GET /api/practitioners': () => ({ status: 200, body: { practitioners: [] } }),
      'GET /api/clinic': () => ({ status: 200, body: clinic }),
    });
    const router = renderApp('/');
    await screen.findByRole('heading', { name: /Bonjour/ });
    expect(screen.getByRole('link', { name: 'Disponibilités' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cabinet' })).not.toBeInTheDocument();
    await router.navigate('/cabinet/praticiens');
    expect(await screen.findByText("Vous n'avez pas accès à cette page.")).toBeInTheDocument();
  });

  it('praticiens : « M’ajouter comme praticien », comptes déjà liés non proposés', async () => {
    const calls = mockApi({
      ...admin,
      'GET /api/practitioners': () => ({ status: 200, body: { practitioners: [linked] } }),
      'GET /api/users': () => ({ status: 200, body: { users } }),
      'POST /api/practitioners': (call) => ({
        status: 201,
        body: { ...linked, id: '01a0de00-0000-7000-8000-0000000000a2', ...(call.body as object) },
      }),
    });
    renderApp('/cabinet/praticiens');
    const list = await screen.findByRole('list', { name: 'Praticiens' });
    expect(within(list).getByText('Compte : Léo Durand')).toBeInTheDocument();
    const account = screen.getByLabelText('Compte de connexion lié');
    expect(within(account).queryByText(/Léo Durand/)).not.toBeInTheDocument();
    expect(within(account).getByText(/Inès Moreau/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'M’ajouter comme praticien'.replace('’', "'") }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      displayName: 'Camille Martin',
      color: '#10b981',
      userId: ME_ID,
    });
  });

  it('types de rendez-vous : durée sur la grille de 5 minutes', async () => {
    const calls = mockApi({
      ...admin,
      'GET /api/appointment-types': () => ({ status: 200, body: { appointmentTypes: [] } }),
      'POST /api/appointment-types': (call) => ({
        status: 201,
        body: {
          id: '01a0de00-0000-7000-8000-0000000000b1',
          status: 'ACTIVE',
          version: 1,
          ...(call.body as object),
        },
      }),
    });
    renderApp('/cabinet/types-de-rendez-vous');
    await screen.findByText(/Aucun type de rendez-vous/);
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Détartrage' } });
    fireEvent.change(screen.getByLabelText('Durée (minutes)'), { target: { value: '32' } });
    expect(screen.getByText('Entre 5 et 480 minutes, par pas de 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Durée (minutes)'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'Détartrage',
      durationMinutes: 45,
      color: '#0ea5e9',
    });
  });

  it('profil : seuls les champs modifiés sont envoyés ; avertissement au changement de fuseau', async () => {
    const calls = mockApi({
      ...admin,
      'GET /api/clinic': () => ({ status: 200, body: clinic }),
      'PATCH /api/clinic': (call) => ({
        status: 200,
        body: { ...clinic, ...(call.body as object) },
      }),
    });
    renderApp('/cabinet');
    const phone = await screen.findByLabelText('Téléphone');
    expect(phone).toHaveValue('01 45 67 89 10');
    fireEvent.change(screen.getByLabelText('Fuseau horaire'), {
      target: { value: 'America/Martinique' },
    });
    expect(screen.getByText(/Changement de fuseau/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ville'), { target: { value: ' Lyon ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Profil enregistré.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      timezone: 'America/Martinique',
      city: 'Lyon',
    });
  });
});
