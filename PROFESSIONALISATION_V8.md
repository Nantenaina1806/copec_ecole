# COPEC — Professionalisation V8

Cette version consolide les améliorations de production sans modifier le système d'authentification des parents.

## Ajouts
- rôle `accueil` séparé de `surveillant`;
- registre visiteurs complet : entrée, sortie, motif, personne visitée, badge, observation;
- RBAC fin via `permission` + `role_permission` + écran Administration > Permissions;
- garde serveur `authorizePermission()` pour les opérations financières, paie, bulletins et documents sensibles;
- contraintes d'intégrité : une seule année active, un responsable principal par élève, une inscription active par élève/année;
- audit append-only;
- certificats officiels immuables;
- recherche globale Ctrl+K sur élèves, parents et références de paiement;
- cookie de session HttpOnly en complément du contrat JWT existant;
- endpoint `/api/ready` pour readiness/monitoring;
- scripts de backup PostgreSQL Windows/Linux;
- interface Accueil dédiée.

## Parent
L'authentification parent existante est volontairement laissée telle quelle en attente des nouvelles informations métier demandées.

## Base neuve
```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/seed.sql
```

## Base existante
```bash
psql "$DATABASE_URL" -f database/migrations/001_professionalisation_2026.sql
```

La migration est non destructive. Avant migration, faire un backup et vérifier les éventuels doublons d'inscriptions/responsables.

## Production
- définir un `JWT_SECRET` aléatoire long;
- HTTPS obligatoire;
- `FRONTEND_URL` strict, jamais `*`;
- S3/R2 recommandé pour les fichiers sur un hébergeur à disque éphémère;
- backups quotidiens + test de restauration périodique;
- monitorer `/api/health` et `/api/ready`;
- ne jamais committer `.env` ni les secrets.
