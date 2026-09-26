import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function mockFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)),
  );
}

describe('App', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('affiche le serveur opérationnel quand /health/ready répond ok', async () => {
    mockFetch({ status: 'ok', checks: { database: 'ok' } });
    render(<App />);
    expect(await screen.findByText('Serveur opérationnel')).toBeInTheDocument();
  });

  it('affiche le serveur indisponible quand la base est en erreur', async () => {
    mockFetch({ status: 'error', checks: { database: 'error' } }, false);
    render(<App />);
    expect(await screen.findByText('Serveur indisponible')).toBeInTheDocument();
  });

  it('traite une réponse hors contrat comme une erreur', async () => {
    mockFetch({ inattendu: true });
    render(<App />);
    expect(await screen.findByText('Serveur indisponible')).toBeInTheDocument();
  });
});
