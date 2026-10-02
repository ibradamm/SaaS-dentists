/*
 * Zod pour l'interface : tout `import … from 'zod'` du navigateur (paquet partagé compris)
 * arrive ici (alias dans vite.config.ts). Zod 4 compile ses validations d'objets avec
 * `new Function` quand l'environnement le permet, et fait ce test dès la construction des
 * schémas. La CSP de l'interface interdit l'évaluation de code (pas de 'unsafe-eval') : sans ce
 * réglage, chaque chargement déclenche une violation. Validation interprétée : même résultat.
 * Le réglage précède ainsi toute construction de schéma, quel que soit le découpage du build.
 */
import * as z from 'zod/v4';

z.config({ jitless: true });

export * from 'zod/v4';
export { z, z as default };
