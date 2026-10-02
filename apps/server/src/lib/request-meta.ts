import { isIP } from 'node:net';

/** Adresse IP normalisée pour l'audit (IPv4 mappée en IPv6 ramenée à IPv4), ou null. */
export function normalizeIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const value = ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
  return isIP(value) ? value : null;
}

export function truncateUserAgent(userAgent: string | undefined | null): string | null {
  return userAgent ? userAgent.slice(0, 300) : null;
}
