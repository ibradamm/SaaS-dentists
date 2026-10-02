/**
 * En-têtes de sécurité des fichiers de l'interface (HTML, scripts, styles). Source unique :
 * appliqués par `vite preview` (parcours de bout en bout, qui vérifient qu'aucune page ne
 * déclenche de violation de la CSP) et à reprendre à l'identique par le proxy de production
 * (Phase 11). L'API envoie les siens (helmet).
 *
 * - Aucun script ni style en ligne : tout vient du build (`'self'`). Les styles posés par
 *   React (propriété `style`) passent par le CSSOM et ne sont pas concernés.
 * - `data:` pour les images : QR code de la double authentification (SVG généré localement).
 * - Pas de `upgrade-insecure-requests` ici : la pile locale est en HTTP ; en production, HSTS
 *   et la redirection du proxy imposent HTTPS.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
