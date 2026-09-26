# ADR 0002 — Migrations de base de données

- Statut : accepté (Phase 1, 2026-09-26)

## Décision

- **Génération** : drizzle-kit génère le SQL à partir du schéma TypeScript (`src/db/schema`). Les objets que Drizzle ne modélise pas (RLS, droits, triggers, contraintes d'exclusion) sont écrits à la main dans des migrations « custom » (`drizzle-kit generate --custom`).
- **Application** : exécuteur maison, strict (`src/db/migrator.ts`), et non le migrateur fourni par Drizzle.
- **Sens unique (fix-forward)** : aucune migration descendante. Une erreur se corrige par une nouvelle migration ; une restauration se fait depuis les sauvegardes (PITR).
- **CI** : `drizzle-kit generate` ne doit produire aucun fichier. Sinon, le schéma a été modifié sans migration committée.

## Pourquoi pas le migrateur de Drizzle

Lecture du code de `drizzle-orm@0.45.3` (`pg-core/dialect.js`, méthode `migrate`) :

1. Il n'applique une migration que si son horodatage est postérieur à celui de la **dernière** migration appliquée. Une migration plus ancienne, par exemple issue d'une autre branche fusionnée ensuite, est **ignorée silencieusement**.
2. Il ne vérifie pas l'empreinte des migrations déjà appliquées : une migration modifiée après coup passe inaperçue.
3. Il ne prend aucun verrou : deux déploiements simultanés peuvent se chevaucher.

L'exécuteur maison :
- prend un verrou consultatif ;
- applique chaque migration dans sa propre transaction ;
- refuse les migrations modifiées, inconnues du code ou hors ordre.

Il fait environ 130 lignes, couvertes par des tests unitaires (planification) et d'intégration (idempotence, deux déploiements concurrents sur une base vierge).

## Écart par rapport au plan validé

Le critère de la Phase 1 prévoyait « migration up/down ». Il est remplacé par :
- application sur base vierge (à chaque exécution des tests) ;
- idempotence ;
- sécurité en concurrence ;
- détection de dérive schéma/migrations en CI.

Raison : une migration descendante en production détruit des données et n'est presque jamais testée en conditions réelles. Elle donne une fausse assurance. La vraie stratégie de retour arrière est la sauvegarde avec restauration à un instant donné (Phase 13).
