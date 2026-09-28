import { randomBytes } from 'node:crypto';
import tls from 'node:tls';
import { SECURITY_HEADERS } from '../../apps/web/security-headers';

/*
 * Vérifications d'un déploiement réel (staging, puis production) par de vraies requêtes HTTP :
 * HTTPS et redirection, TLS, en-têtes de l'interface et de l'API, CORS, erreurs, cookies de
 * session, limitation de débit derrière le proxy. Lecture seule, sauf une connexion avec un
 * compte de test fourni et des tentatives de connexion sur des adresses inexistantes.
 * Données synthétiques uniquement ; ne jamais viser une production avec des comptes réels.
 */

export type CheckStatus = 'OK' | 'ÉCHEC' | 'IGNORÉ';
export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DeploymentCheckOptions {
  /** Adresse publique de l'interface, par exemple https://staging.exemple.fr */
  url: string;
  /** Pile locale en HTTP (auto-test de l'outil) : HTTPS, TLS et redirection ignorés. */
  local?: boolean;
  /** Compte de test synthétique sans double authentification (secrétaire) : cookies. */
  account?: { email: string; password: string };
  /** Tentatives de connexion pour vérifier la limitation derrière le proxy (12 requêtes). */
  rateLimit?: boolean;
}

const EVIL_ORIGIN = 'https://attaquant.example';
const LEAKS = /select |insert |\bat \w+ \(|node_modules|\/home\/|\/app\/|stack|Error:/i;
const MIN_HSTS_SECONDS = 15_552_000; // 180 jours

export async function runDeploymentChecks(options: DeploymentCheckOptions): Promise<CheckResult[]> {
  const base = new URL(options.url);
  const at = (path: string) => new URL(path, base).toString();
  const results: CheckResult[] = [];
  const check = async (name: string, run: () => Promise<[CheckStatus, string]>) => {
    try {
      const [status, detail] = await run();
      results.push({ name, status, detail });
    } catch (error) {
      results.push({ name, status: 'ÉCHEC', detail: (error as Error).message });
    }
  };
  const skipLocal = (why: string): [CheckStatus, string] => ['IGNORÉ', `pile locale : ${why}`];

  await check('HTTPS', () => {
    if (options.local) return Promise.resolve(skipLocal('HTTP'));
    return Promise.resolve<[CheckStatus, string]>(
      base.protocol === 'https:'
        ? ['OK', 'adresse en https']
        : ['ÉCHEC', `adresse en ${base.protocol}`],
    );
  });

  await check('Redirection HTTP → HTTPS', async () => {
    if (options.local) return skipLocal('pas de port 80');
    const http = new URL(base);
    http.protocol = 'http:';
    const res = await fetch(http, { redirect: 'manual' });
    const location = res.headers.get('location') ?? '';
    return [301, 308].includes(res.status) && location.startsWith(`https://${base.host}`)
      ? ['OK', `${res.status} vers ${location}`]
      : ['ÉCHEC', `${res.status}, location « ${location} »`];
  });

  await check('TLS', async () => {
    if (options.local) return skipLocal('pas de TLS');
    const info = await new Promise<{ protocol: string; authorized: boolean; validTo: string }>(
      (resolve, reject) => {
        const socket = tls.connect(
          { host: base.hostname, port: Number(base.port || 443), servername: base.hostname },
          () => {
            resolve({
              protocol: socket.getProtocol() ?? '',
              authorized: socket.authorized,
              validTo: socket.getPeerCertificate().valid_to,
            });
            socket.end();
          },
        );
        socket.on('error', reject);
      },
    );
    const days = Math.floor((Date.parse(info.validTo) - Date.now()) / 86_400_000);
    const ok = info.authorized && ['TLSv1.2', 'TLSv1.3'].includes(info.protocol) && days >= 14;
    return [
      ok ? 'OK' : 'ÉCHEC',
      `${info.protocol}, certificat valide : ${info.authorized}, expire dans ${days} j`,
    ];
  });

  await check('En-têtes de l’interface', async () => {
    const res = await fetch(at('/'));
    const missing: string[] = [];
    for (const [name, expected] of Object.entries(SECURITY_HEADERS)) {
      const value = res.headers.get(name);
      if (!value) missing.push(`${name} absent`);
      else if (name === 'Content-Security-Policy' && value !== expected) {
        missing.push('CSP différente de apps/web/security-headers.ts');
      }
    }
    const hsts = /max-age=(\d+)/.exec(res.headers.get('strict-transport-security') ?? '');
    if (!options.local && (!hsts || Number(hsts[1]) < MIN_HSTS_SECONDS)) {
      missing.push('HSTS inférieur à 180 jours');
    }
    return missing.length === 0
      ? ['OK', `${res.status}, ${Object.keys(SECURITY_HEADERS).length} en-têtes`]
      : ['ÉCHEC', missing.join(' ; ')];
  });

  await check('En-têtes de l’API et réponse sans session', async () => {
    const res = await fetch(at('/api/auth/me'));
    const body = await res.text();
    const missing = [
      'content-security-policy',
      'strict-transport-security',
      'x-content-type-options',
      'x-frame-options',
      'referrer-policy',
    ].filter((h) => !res.headers.get(h));
    const ok = res.status === 401 && missing.length === 0 && body.includes('"UNAUTHENTICATED"');
    return [
      ok ? 'OK' : 'ÉCHEC',
      `${res.status}${missing.length ? ` ; absents : ${missing.join(', ')}` : ''}`,
    ];
  });

  await check('CORS : origine étrangère refusée', async () => {
    const preflight = await fetch(at('/api/auth/login'), {
      method: 'OPTIONS',
      headers: {
        origin: EVIL_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-csrf-token',
      },
    });
    const simple = await fetch(at('/api/auth/me'), { headers: { origin: EVIL_ORIGIN } });
    const problems: string[] = [];
    for (const [label, res] of [
      ['pré-vol', preflight],
      ['GET', simple],
    ] as const) {
      const allow = res.headers.get('access-control-allow-origin');
      if (allow === '*' || allow === EVIL_ORIGIN) problems.push(`${label} : allow-origin ${allow}`);
      if (res.headers.get('access-control-allow-credentials') === 'true' && allow) {
        problems.push(`${label} : credentials autorisés`);
      }
    }
    return problems.length === 0
      ? ['OK', `aucune autorisation pour ${EVIL_ORIGIN} (pré-vol ${preflight.status})`]
      : ['ÉCHEC', problems.join(' ; ')];
  });

  await check('Erreurs sans détail technique', async () => {
    const malformed = await fetch(at('/api/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email": cassé',
    });
    const unknown = await fetch(at('/api/route-inexistante'));
    const problems: string[] = [];
    for (const [label, res, expected] of [
      ['JSON invalide', malformed, 400],
      ['route inconnue', unknown, 404],
    ] as const) {
      const text = await res.text();
      if (res.status !== expected) problems.push(`${label} : ${res.status}`);
      if (LEAKS.test(text)) problems.push(`${label} : détail technique renvoyé`);
      if (!text.includes('"requestId"')) problems.push(`${label} : format d'erreur inattendu`);
    }
    return problems.length === 0
      ? ['OK', '400 et 404 au format standard']
      : ['ÉCHEC', problems.join(' ; ')];
  });

  await check('Cookie de session', async () => {
    if (!options.account) return ['IGNORÉ', 'aucun compte de test fourni (--email, --password)'];
    const login = await fetch(at('/api/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(options.account),
    });
    const cookie = login.headers.getSetCookie().find((c) => /dental_session=/.test(c)) ?? '';
    const attrs = cookie.split(';').map((p) => p.trim().toLowerCase());
    const problems: string[] = [];
    if (login.status !== 200) problems.push(`connexion : ${login.status}`);
    if (!attrs.includes('httponly')) problems.push('HttpOnly absent');
    if (!attrs.includes('samesite=lax')) problems.push('SameSite=Lax absent');
    if (!attrs.includes('path=/')) problems.push('Path=/ absent');
    if (attrs.some((a) => a.startsWith('domain='))) problems.push('Domain présent');
    if (!options.local) {
      if (!cookie.startsWith('__Host-')) problems.push('préfixe __Host- absent');
      if (!attrs.includes('secure')) problems.push('Secure absent');
    }
    const { csrfToken } = (await login.json().catch(() => ({}))) as { csrfToken?: string };
    const pair = cookie.split(';')[0] ?? '';
    const me = await fetch(at('/api/auth/me'), { headers: { cookie: pair } });
    if (me.status !== 200) problems.push(`session non reconnue : ${me.status}`);
    const logout = await fetch(at('/api/auth/logout'), {
      method: 'POST',
      headers: { cookie: pair, 'x-csrf-token': csrfToken ?? '', origin: base.origin },
    });
    const after = await fetch(at('/api/auth/me'), { headers: { cookie: pair } });
    if (logout.status !== 204 || after.status !== 401) {
      problems.push(`déconnexion : ${logout.status}, puis ${after.status}`);
    }
    return problems.length === 0
      ? [
          'OK',
          options.local
            ? 'HttpOnly, SameSite=Lax, Path=/ ; déconnexion effective'
            : '__Host-, Secure, HttpOnly, SameSite=Lax, Path=/ ; déconnexion effective',
        ]
      : ['ÉCHEC', problems.join(' ; ')];
  });

  await check('Limitation derrière le proxy (X-Forwarded-For usurpé)', async () => {
    if (!options.rateLimit) return ['IGNORÉ', 'désactivé (--rate-limit pour l’activer)'];
    // 12 tentatives sur des adresses inexistantes, chacune avec une fausse adresse IP : si le
    // proxy et API_TRUST_PROXY_HOPS sont justes, la limite (10 par minute) s'applique quand même.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await fetch(at('/api/auth/login'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': `203.0.113.${i + 1}`,
        },
        body: JSON.stringify({
          email: `inexistant.${randomBytes(4).toString('hex')}@exemple.invalid`,
          password: 'x',
        }),
      });
      statuses.push(res.status);
    }
    return statuses.includes(429)
      ? ['OK', `429 atteint malgré l'en-tête usurpé (${statuses.join(' ')})`]
      : [
          'ÉCHEC',
          `aucun 429 : l'adresse du client est lue dans l'en-tête usurpé (${statuses.join(' ')})`,
        ];
  });

  return results;
}
