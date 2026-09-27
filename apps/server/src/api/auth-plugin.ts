import type { Permission, SessionRestriction } from '@dental/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors';
import { normalizeIp, truncateUserAgent } from '../lib/request-meta';
import type { AuthService } from '../modules/auth/auth.service';
import type { AuthenticatedSession, RequestMeta, UserActor } from '../modules/auth/auth.types';
import { authorize, authorizeAny } from '../modules/auth/authorize';
import { safeEqual } from '../modules/auth/tokens';
import { readSessionCookie, type CookiePolicy } from './session-cookie';

/**
 * Configuration d'accès d'une route, obligatoire sur toute route (docs/adr/0011) :
 * - public : aucune session requise (connexion, santé) ;
 * - authenticated : session complète, sans permission particulière ;
 * - allow : étapes d'authentification tolérées (par défaut aucune : accès complet requis) ;
 * - permission : permission exigée (vérifiée aussi par le service appelé).
 * - anyPermission : au moins une des permissions (portée exacte vérifiée par le service).
 */
export interface RouteAccess {
  public?: boolean;
  authenticated?: boolean;
  allow?: readonly SessionRestriction[];
  permission?: Permission;
  /** Au moins une de ces permissions ; le service vérifie ensuite la portée exacte. */
  anyPermission?: readonly Permission[];
}

export interface RouteInventoryEntry {
  method: string;
  url: string;
  access: RouteAccess;
}

const inventories = new WeakMap<FastifyInstance, RouteInventoryEntry[]>();

/** Routes enregistrées et leur politique d'accès (tests de sécurité systématiques). */
export function routeInventory(app: FastifyInstance): readonly RouteInventoryEntry[] {
  return inventories.get(app) ?? [];
}

function declaresAccess(access: RouteAccess | undefined): access is RouteAccess {
  return Boolean(
    access &&
    (access.public ||
      access.authenticated ||
      access.allow ||
      access.permission ||
      access.anyPermission),
  );
}

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
  interface FastifyRequest {
    auth: AuthenticatedSession | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requestMeta(request: FastifyRequest): RequestMeta {
  return {
    ip: normalizeIp(request.ip),
    userAgent: truncateUserAgent(request.headers['user-agent']),
    requestId: String(request.id),
  };
}

/** Session authentifiée de la requête ; n'est appelée que sur une route protégée. */
export function sessionOf(request: FastifyRequest): AuthenticatedSession {
  if (!request.auth) throw new AppError('UNAUTHENTICATED', 'Authentification requise', 401);
  return request.auth;
}

export function actorOf(request: FastifyRequest): UserActor {
  return sessionOf(request).actor;
}

export function registerAuth(
  app: FastifyInstance,
  deps: { auth: AuthService; cookies: CookiePolicy; webOrigin: string },
) {
  app.decorateRequest('auth', null);
  const inventory: RouteInventoryEntry[] = [];
  inventories.set(app, inventory);

  // Refus au démarrage d'une route sans politique d'accès : un oubli ne peut pas ouvrir une
  // route à tout compte connecté.
  app.addHook('onRoute', (route) => {
    const access = route.config?.access;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!declaresAccess(access)) {
      throw new Error(`Route ${methods.join(',')} ${route.url} sans politique d'accès`);
    }
    for (const method of methods) inventory.push({ method, url: route.url, access });
  });

  // Avant la lecture du corps (après la limitation du nombre de requêtes) : une requête non
  // authentifiée ou d'une autre origine est refusée sans que son corps soit analysé.
  app.addHook('preParsing', async (request: FastifyRequest, _reply: FastifyReply, payload) => {
    if (request.is404) return payload;
    const access = request.routeOptions.config.access ?? {};
    const unsafe = !SAFE_METHODS.has(request.method);

    // Toute requête modifiante venant d'un navigateur doit provenir de l'interface.
    const origin = request.headers.origin;
    if (unsafe && origin !== undefined && origin !== deps.webOrigin) {
      throw new AppError('CSRF_INVALID', 'Origine de la requête refusée', 403);
    }
    if (access.public) return payload;

    const token = readSessionCookie(request, deps.cookies);
    const session = token ? await deps.auth.resolveSession(token) : null;
    if (!session) throw new AppError('UNAUTHENTICATED', 'Authentification requise', 401);
    request.auth = session;

    if (session.restriction && !(access.allow ?? []).includes(session.restriction)) {
      throw new AppError(
        'AUTH_STEP_REQUIRED',
        "Terminez d'abord l'étape d'authentification en cours",
        403,
      );
    }
    if (unsafe) {
      const header = request.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(header, session.csrfToken)) {
        throw new AppError('CSRF_INVALID', 'Jeton de sécurité invalide, rechargez la page', 403);
      }
    }
    if (access.permission) authorize(session.actor, access.permission);
    if (access.anyPermission) authorizeAny(session.actor, access.anyPermission);
    return payload;
  });
}
