import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());

const patient = {
  id: '01a0de00-0000-7000-8000-0000000000a1',
  lastName: 'Durand',
  firstName: 'Alice',
};

/** fetch dont chaque réponse attend qu'on la libère : requêtes réellement simultanées. */
function deferredFetch() {
  const pending: (() => void)[] = [];
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(() =>
          resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })),
        );
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return { fetch, release: () => pending.splice(0).forEach((r) => r()) };
}

describe('envois simultanés identiques', () => {
  it('un double envoi pendant la requête ne part qu’une fois ; les deux appels ont la réponse', async () => {
    const { fetch, release } = deferredFetch();
    const body = { lastName: patient.lastName, firstName: patient.firstName, contacts: [] };
    const first = api.createPatient(body).catch((e: unknown) => e);
    const second = api.createPatient({ ...body }).catch((e: unknown) => e);
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    // Même issue pour les deux appels (ici une réponse hors contrat, identique pour les deux).
    expect(await second).toBe(await first);
  });

  it('corps différents ou envoi après la réponse : chaque requête part', async () => {
    const { fetch, release } = deferredFetch();
    const one = api.createPatient({ lastName: 'Durand', firstName: 'Alice', contacts: [] });
    const two = api.createPatient({ lastName: 'Durand', firstName: 'Alicia', contacts: [] });
    expect(fetch).toHaveBeenCalledTimes(2);
    release();
    await Promise.allSettled([one, two]);
    const again = api.createPatient({ lastName: 'Durand', firstName: 'Alice', contacts: [] });
    expect(fetch).toHaveBeenCalledTimes(3);
    release();
    await again.catch(() => undefined);
  });
});
