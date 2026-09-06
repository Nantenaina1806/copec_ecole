# COPEC V10 — Finalisation professionnelle

## Ce que V10 ajoute

1. **Mode DEMO / PRODUCTION** : les envois externes sont limités en DEMO pour le stage. Les limites sont configurables par `DEMO_EMAIL_DAILY_LIMIT` et `DEMO_WHATSAPP_DAILY_LIMIT`.
2. **Communication Center** : état des fournisseurs, usage, livraisons et historique sur 30 jours.
3. **Forgot password renforcé** : token aléatoire hashé, expiration 30 minutes, usage unique et invalidation des sessions via `security_version`.
4. **Notifications** : email/WhatsApp utilisent désormais un vrai statut provider; aucune réussite fictive n'est affichée.
5. **Security hardening** : rate limits, Helmet, validation, audit et rotation de version de sécurité.
6. **Backup / Restore** : sauvegarde PostgreSQL manuelle, sauvegarde automatique quotidienne optionnelle, checksum SHA-256, rétention; restauration désactivée par défaut et protégée par double confirmation.
7. **Health monitoring** : API/DB, stockage, backup storage, email, WhatsApp et dernière sauvegarde.

## Démo stage recommandée

- `COPEC_MODE=demo`
- `DEMO_EMAIL_DAILY_LIMIT=20`
- `DEMO_WHATSAPP_DAILY_LIMIT=5`
- `BACKUP_AUTO=false` pendant les tests locaux
- Configurer seulement quelques adresses/numeros de test.

## Passage en production

L'école doit fournir ses propres credentials : email officiel/provider et WhatsApp Business/Cloud API. Ne jamais mettre de secrets dans Git ou dans `seed.sql`.

Pour les sauvegardes automatiques : `BACKUP_AUTO=true`. Pour autoriser la restauration depuis l'interface admin : `ALLOW_DB_RESTORE=true`, uniquement après validation de la procédure de sauvegarde.

## Prérequis système
gggggggggggggggggggggggg

Les fonctions de sauvegarde/restauration utilisent les binaires PostgreSQL `pg_dump` et `psql`, accessibles dans le PATH du serveur.
