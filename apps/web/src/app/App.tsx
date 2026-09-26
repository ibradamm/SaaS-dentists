import { useEffect, useState } from 'react';
import { fetchReadiness } from '../lib/api';

type ApiState = 'loading' | 'ok' | 'error';

const LABELS: Record<ApiState, string> = {
  loading: 'Vérification du serveur…',
  ok: 'Serveur opérationnel',
  error: 'Serveur indisponible',
};

/** Écran provisoire de la phase 1 : vérifie la chaîne interface → API → base de données. */
export function App() {
  const [state, setState] = useState<ApiState>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetchReadiness(controller.signal)
      .then((res) => setState(res.status === 'ok' ? 'ok' : 'error'))
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Plateforme de gestion du cabinet</h1>
      <p role="status" className={state === 'error' ? 'text-red-700' : 'text-slate-700'}>
        {LABELS[state]}
      </p>
    </main>
  );
}
