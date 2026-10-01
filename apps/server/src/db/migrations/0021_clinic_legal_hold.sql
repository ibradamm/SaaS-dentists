-- Conservation pour litige (docs/adr/0014) : date de pose, nulle hors litige. Le rôle applicatif
-- la lit (droit SELECT sur la table) sans pouvoir la modifier (droits UPDATE limités aux
-- paramètres et coordonnées, migrations 0002 et 0010) : seule l'administration la pose ou la lève.
ALTER TABLE "clinics" ADD COLUMN "legal_hold_since" timestamp with time zone;
