import type { MeResponse } from '@dental/shared';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { me, mockApi, renderApp, unauthenticated } from '../test/render';
import { createAppQueryClient } from './query-client';

afterEach(() => vi.unstubAllGlobals());

const other = (base: MeResponse, clinicId: string): MeResponse => ({
  ...base,
  clinic: { ...base.clinic, id: clinicId, name: 'Autre cabinet' },
});

describe('cache des requêtes et sessions', () => {
  it('aucune donnée d’une session n’est gardée pour une autre (compte, cabinet, déconnexion)', () => {
    const client = createAppQueryClient({ retry: false });
    const secretary = me('SECRETARY');
    client.setQueryData(['me'], secretary);
    client.setQueryData(['patients', 'liste'], ['DUPONT']);
    // Même session relue (jeton CSRF renouvelé, par exemple) : le cache est gardé.
    client.setQueryData(['me'], { ...secretary, csrfToken: 'autre' });
    expect(client.getQueryData(['patients', 'liste'])).toEqual(['DUPONT']);
    // Même personne, autre cabinet : tout est vidé.
    client.setQueryData(['me'], other(secretary, '01a0de00-0000-7000-8000-0000000000c2'));
    expect(client.getQueryData(['patients', 'liste'])).toBeUndefined();
    // Déconnexion (session nulle) : vidé aussi.
    client.setQueryData(['agenda'], ['rdv']);
    client.setQueryData(['me'], null);
    expect(client.getQueryData(['agenda'])).toBeUndefined();
    expect(client.getQueryData(['me'])).toBeNull();
  });

  it('session expirée en cours d’usage (401) : retour à la connexion', async () => {
    let expired = false;
    mockApi({
      'GET /api/auth/me': () =>
        expired ? unauthenticated : { status: 200, body: me('SECRETARY') },
      'POST /api/patients/search': () => {
        expired = true;
        return unauthenticated;
      },
    });
    renderApp('/patients');
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument();
  });
});
