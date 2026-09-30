import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { generate } from 'otplib';
import { httpSession, type HttpSession } from '../support/http-session';

/*
 * Comptes de test synthétiques d'un environnement hébergé (staging), par l'API publique :
 *   1. première connexion de l'administrateur créé par `create-admin` (mot de passe temporaire
 *      dans ADMIN_TEMPORARY_PASSWORD, jamais en argument) : nouveau mot de passe, double
 *      authentification ;
 *   2. création d'une secrétaire, puis sa première connexion.
 * Les identifiants obtenus sont écrits dans --out (droits 600), jamais affichés : ils servent à
 * check:deployment (compte secrétaire, sans double authentification).
 *   pnpm --filter @dental/e2e staging:accounts --url https://… --admin-email … --out comptes.json
 * Données synthétiques uniquement.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'admin-email': { type: 'string' },
    'secretary-email': { type: 'string' },
    out: { type: 'string' },
  },
});
const temporary = process.env.ADMIN_TEMPORARY_PASSWORD;
if (!values.url || !values['admin-email'] || !values.out || !temporary) {
  console.error(
    'Usage : ADMIN_TEMPORARY_PASSWORD=… staging:accounts --url https://… --admin-email … --out fichier',
  );
  process.exit(2);
}
const base = new URL(values.url);
const newPassword = () => randomBytes(18).toString('base64url');

interface Step {
  restriction: string | null;
}

/** Première connexion : mot de passe temporaire remplacé ; renvoie l'étape suivante. */
async function firstLogin(call: HttpSession, email: string, password: string) {
  const login = await call<Step>('POST', '/api/auth/login', { email, password });
  if (login.restriction !== 'PASSWORD_CHANGE_REQUIRED') {
    throw new Error(`${email} : étape inattendue (${login.restriction})`);
  }
  const replacement = newPassword();
  const next = await call<Step>('POST', '/api/auth/password', {
    currentPassword: password,
    newPassword: replacement,
  });
  return { password: replacement, restriction: next.restriction };
}

const admin = httpSession(base);
const adminEmail = values['admin-email'];
const adminLogin = await firstLogin(admin, adminEmail, temporary);
if (adminLogin.restriction !== 'MFA_ENROLLMENT_REQUIRED') {
  throw new Error(`administrateur : étape inattendue (${adminLogin.restriction})`);
}
const { secret } = await admin<{ secret: string }>('POST', '/api/auth/mfa/setup');
await admin('POST', '/api/auth/mfa/activate', { code: await generate({ secret }) });

const secretaryEmail =
  values['secretary-email'] ?? `secretaire.${randomBytes(3).toString('hex')}@exemple.invalid`;
const created = await admin<{ temporaryPassword: string }>('POST', '/api/users', {
  email: secretaryEmail,
  fullName: 'Secrétaire de test',
  role: 'SECRETARY',
});
const secretary = await firstLogin(httpSession(base), secretaryEmail, created.temporaryPassword);
if (secretary.restriction !== null) {
  throw new Error(`secrétaire : étape inattendue (${secretary.restriction})`);
}

writeFileSync(
  values.out,
  JSON.stringify(
    {
      url: base.origin,
      admin: { email: adminEmail, password: adminLogin.password, totpSecret: secret },
      secretary: { email: secretaryEmail, password: secretary.password },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(`Comptes de test prêts (administrateur et secrétaire) : ${values.out}`);
