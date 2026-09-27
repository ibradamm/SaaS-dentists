/*
 * Budget du chargement initial (ADR 0008) : le JavaScript téléchargé pour afficher la page de
 * connexion (fichier d'entrée et ses imports statiques) ne dépasse pas BUDGET_KB compressés.
 * Une bibliothèque lourde importée par erreur dans le socle (au lieu d'une page chargée à la
 * demande) fait échouer la CI. À lancer après `vite build`.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 160;
const dist = path.resolve(import.meta.dirname, '../dist');
const manifestPath = path.join(dist, '.vite/manifest.json');
if (!existsSync(manifestPath)) {
  console.error('Manifeste introuvable : lancer « vite build » avant la vérification.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
if (entries.length !== 1) {
  console.error(`Un seul point d'entrée attendu, ${entries.length} trouvé(s).`);
  process.exit(1);
}

const initial = new Set();
const walk = (key) => {
  if (initial.has(key)) return;
  initial.add(key);
  for (const next of manifest[key].imports ?? []) walk(next);
};
walk(entries[0]);

let total = 0;
const rows = [...initial].map((key) => {
  const file = manifest[key].file;
  const size = gzipSync(readFileSync(path.join(dist, file))).length / 1024;
  total += size;
  return { file, size };
});
for (const { file, size } of rows.sort((a, b) => b.size - a.size)) {
  console.log(`${size.toFixed(1).padStart(7)} ko  ${file}`);
}
console.log(`Chargement initial : ${total.toFixed(1)} ko compressés (budget : ${BUDGET_KB} ko).`);
if (total > BUDGET_KB) {
  console.error('Budget dépassé : une bibliothèque lourde est-elle importée dans le socle ?');
  process.exit(1);
}
