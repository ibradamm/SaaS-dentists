-- Recherche approximative sur le nom des patients (index trigramme). Extension « trusted » :
-- installable par le propriétaire de la base, sans superutilisateur.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
