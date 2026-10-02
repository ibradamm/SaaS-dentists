// Charge les déclarations de types de @fastify/cookie (request.cookies, reply.setCookie).
import '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Cookie de session : httpOnly (inaccessible au JavaScript), SameSite=Lax, Secure hors local.
 * Hors local, le préfixe __Host- impose Secure, Path=/ et l'absence de Domain.
 */
export interface CookiePolicy {
  secure: boolean;
}

export const cookieName = (policy: CookiePolicy) =>
  policy.secure ? '__Host-dental_session' : 'dental_session';

export function readSessionCookie(
  request: FastifyRequest,
  policy: CookiePolicy,
): string | undefined {
  return request.cookies[cookieName(policy)];
}

export function setSessionCookie(
  reply: FastifyReply,
  policy: CookiePolicy,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(cookieName(policy), token, {
    httpOnly: true,
    secure: policy.secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, policy: CookiePolicy) {
  reply.clearCookie(cookieName(policy), {
    httpOnly: true,
    secure: policy.secure,
    sameSite: 'lax',
    path: '/',
  });
}
