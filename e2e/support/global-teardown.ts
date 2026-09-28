import { existsSync, readFileSync } from 'node:fs';
import { API_LOG, WORKER_LOG } from './env';
import { FORBIDDEN_IN_LOGS } from './sentinels';

/**
 * Journaux réels de l'API et du worker après tous les parcours : aucune donnée saisie par les
 * tests (noms de patients, notes, téléphone, mot de passe). Échec de l'exécution sinon.
 */
export default function globalTeardown() {
  const found: string[] = [];
  for (const file of [API_LOG, WORKER_LOG]) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const value of FORBIDDEN_IN_LOGS) {
      if (text.includes(value)) found.push(`${file} : « ${value} »`);
    }
  }
  if (found.length > 0) {
    throw new Error(`Données saisies retrouvées dans les journaux :\n${found.join('\n')}`);
  }
}
