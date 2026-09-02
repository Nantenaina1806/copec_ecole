# COPEC Windows — Offline-first + Auto-Sync

## Objectif
Un utilisateur installe `COPEC-Setup.exe`, se connecte et travaille sans Internet.

Le PC embarque PostgreSQL localement. pgAdmin, PostgreSQL et Node.js ne sont pas requis pour l'utilisateur.

## Synchronisation
Si `DATABASE_URL centrale` est configurée, le backend local active automatiquement le worker de synchronisation. Hors connexion, les écritures restent dans `sync_change`; à la reconnexion, push puis pull sont exécutés automatiquement.

## Développeur
Le PC développeur peut conserver son PostgreSQL + pgAdmin. Avant le build Windows :

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\build-windows-offline.ps1
```

Le script copie le PostgreSQL installé dans `vendor/postgresql` afin que l'installeur puisse être utilisé sur un PC qui n'a aucun PostgreSQL.

## Base centrale
La base centrale doit déjà avoir `database/schema.sql` et, si nécessaire sur une base existante, `scripts/sync-schema-addon.sql`.

Ne jamais exécuter `database/schema.sql` sur une base centrale contenant des données réelles sans sauvegarde/migration contrôlée : ce fichier contient des DROP pour installation neuve.
