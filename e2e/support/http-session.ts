/**
 * Client HTTP d'une session de l'application (scripts contre un environnement hébergé) : cookie
 * et jeton CSRF renouvelés à chaque étape d'authentification ; origine envoyée sur les POST.
 * Lève une erreur sur toute réponse non 2xx.
 */
export function httpSession(base: URL) {
  let cookie = '';
  let csrf = '';
  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    const res = await fetch(new URL(path, base), {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookie ? { cookie } : {}),
        ...(method === 'POST' ? { origin: base.origin, 'x-csrf-token': csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const set = res.headers.getSetCookie().find((c) => c.includes('dental_session='));
    if (set) cookie = set.split(';')[0] ?? '';
    const json = (await res.json().catch(() => ({}))) as T & { csrfToken?: string };
    if (!res.ok) throw new Error(`${method} ${path} : ${res.status} ${JSON.stringify(json)}`);
    if (json.csrfToken) csrf = json.csrfToken;
    return json;
  };
  // Cookie et jeton courants, pour des requêtes faites hors de ce client (mesures de temps).
  return Object.assign(call, { cookie: () => cookie, csrf: () => csrf });
}

export type HttpSession = ReturnType<typeof httpSession>;
