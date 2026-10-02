-- Mention « sans facturation » d'un rendez-vous (docs/adr/0010, section 10) : modifiable par
-- l'application, seule colonne ajoutée aux droits de mise à jour des rendez-vous.
GRANT UPDATE (billing_exempt) ON appointments TO dental_app;
