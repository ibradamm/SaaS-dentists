import type { MeResponse } from '@dental/shared';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

const ME = 'me';
const isMe = (key: readonly unknown[]) => key[0] === ME;

/**
 * Cache des requêtes de l'application (ADR 0008, section 4) :
 * - une réponse 401 en cours d'usage (session expirée ou révoquée) relit la session, ce qui
 *   ramène à la connexion ;
 * - aucune donnée d'une session n'est affichée dans une autre : dès que l'identité change
 *   (déconnexion, expiration, autre compte ou autre cabinet), tout le cache est vidé.
 */
export function createAppQueryClient(options: { retry?: number | false } = {}): QueryClient {
  const maxRetries = options.retry === false ? 0 : (options.retry ?? 1);
  const onUnauthenticated = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      void client.invalidateQueries({ queryKey: [ME] });
    }
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!isMe(query.queryKey)) onUnauthenticated(error);
      },
    }),
    mutationCache: new MutationCache({ onError: onUnauthenticated }),
    defaultOptions: {
      queries: {
        // Une erreur 4xx ne se corrige pas en réessayant (droits, session, validation).
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status < 500) && failures < maxRetries,
      },
    },
  });
  isolateSessions(client);
  return client;
}

/** Vide le cache (hors session) quand l'identité de la session change. */
export function isolateSessions(client: QueryClient): () => void {
  let identity: string | null | undefined;
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || !isMe(event.query.queryKey as readonly unknown[])) return;
    const me = event.query.state.data as MeResponse | null | undefined;
    if (me === undefined) return;
    const next = me ? `${me.clinic.id}:${me.user.id}` : null;
    if (identity !== undefined && next !== identity) {
      client.removeQueries({ predicate: (q) => !isMe(q.queryKey) });
    }
    identity = next;
  });
}
