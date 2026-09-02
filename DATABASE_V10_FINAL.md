# COPEC V10 FINAL — structure de base de données

## Structure simplifiée

Le dossier `database/` contient volontairement uniquement :

- `schema.sql` — **source de vérité unique** de toute la structure PostgreSQL ;
- `seed.sql` — données initiales/de démonstration.

Toutes les anciennes migrations de structure ont été fusionnées dans `schema.sql` : sécurité, récupération de mot de passe, communication, sauvegardes, RBAC, registre visiteurs, contraintes métier, paie, EDT, etc.

### Installation d'une base neuve

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/seed.sql
```

`seed.sql` reste séparé afin que la structure et les données soient faciles à lire, sauvegarder et réinitialiser indépendamment.

### Important

`schema.sql` contient des `DROP TABLE ... CASCADE` au début : il est destiné à une **base neuve / réinitialisation assumée**. Ne pas l'exécuter sur une base de production contenant des données sans backup et procédure de migration dédiée.


## Audit schema/seed — correctif final
- `schema.sql` supprime maintenant aussi les 5 tables V10 (`password_reset_token`, `notification_delivery`, `security_event`, `communication_usage`, `system_backup`) lors d'une réinstallation complète.
- `seed.sql` renseigne désormais `classe_id` et `annee_scolaire_id` dans `examen_matiere`, colonnes rendues NOT NULL par `schema.sql`.
- `schema.sql` reste DESTRUCTIF : il supprime/recrée les tables. Ne pas l'exécuter sur un Neon contenant des données à conserver.
