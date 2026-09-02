# COPEC — Online + Offline + Réseau local + Neon + Auto-Sync

## Architecture retenue

COPEC fonctionne avec **un serveur local dans l'établissement**. Les PC se connectent au serveur local par le réseau LAN/Wi-Fi, même lorsque l'Internet est coupé. Le serveur local possède une copie PostgreSQL opérationnelle et une file de changements (`sync_change`).

Lorsque l'Internet revient, le backend local synchronise automatiquement :

- les changements locaux vers Neon ;
- les changements faits sur Neon vers la base locale ;
- les conflits sont détectés et conservés dans `sync_conflict` au lieu d'être écrasés silencieusement.

Les utilisateurs n'ont pas à faire d'import/export manuel.

## Pourquoi cette architecture pour ~50 utilisateurs ?

Il n'y a pas 50 bases qui se synchronisent entre elles. Il y a **une base locale d'établissement** pour les opérations quotidiennes et **une base Neon centrale** pour la centralisation hors site. Cela réduit fortement les conflits et la maintenance.

```text
                    INTERNET
                       │
                    NEON
                       ↕
                 Auto-Sync COPEC
                       ↕
              SERVEUR LOCAL ÉCOLE
                       │
             ┌─────────┼─────────┐
             │         │         │
            PC        PC       PC...
             └────── réseau LAN ─┘
```

## Installation locale

Pré-requis : Docker Desktop sur le PC qui joue le rôle de serveur local.

1. Préparer `.env` à partir de `backend/.env.example` et définir un vrai `JWT_SECRET`.
2. Définir `CENTRAL_DATABASE_URL` avec la chaîne de connexion Neon.
3. Lancer :

```bash
docker compose -f docker-compose.local.yml up -d --build
```

4. Ouvrir `http://localhost` sur le serveur local.
5. Depuis les autres PC du même réseau, ouvrir `http://IP_DU_SERVEUR_LOCAL`.

## Initialisation Neon

Sur la base Neon centrale, exécuter une fois :

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/seed.sql
psql "$DATABASE_URL" -f scripts/sync-central-init.sql
```

**Attention :** `database/schema.sql` recrée les tables et efface les données existantes. Ne l'exécuter sur une base contenant des données réelles que dans le cadre d'une installation prévue pour cela.

## Règles de synchronisation

- Push local d'abord, puis pull central.
- Les changements sont envoyés par lots de 200.
- Le worker réessaie automatiquement toutes les 15 secondes par défaut.
- Une coupure Internet ne bloque pas les opérations locales.
- Les tables techniques de synchronisation ne se répliquent pas elles-mêmes.
- Les IDs créés localement utilisent une plage haute pour éviter les collisions avec les IDs centraux.
- Les conflits de mise à jour/suppression ou de contraintes uniques sont enregistrés dans `sync_conflict`.
- La résolution automatique d'un conflit dangereux n'écrase pas silencieusement la donnée locale.

## Statut dans l'interface

La barre supérieure affiche :

- **Synchronisé** : serveur local et Neon communiquent normalement ;
- **Local · en attente** : l'application continue de fonctionner et les changements attendent la connexion ;
- **Hors connexion** : le poste n'a plus de connexion réseau ;
- **Synchronisation…** : un échange est en cours.

Le bouton de synchronisation manuelle existe uniquement comme outil d'administration (`POST /api/sync/now`) ; le fonctionnement normal est automatique.

## Important — mobile

Cette version prépare **PC + serveur local + LAN + Neon + auto-sync**. Le mobile n'est volontairement pas inclus dans cette phase, conformément au périmètre actuel.
