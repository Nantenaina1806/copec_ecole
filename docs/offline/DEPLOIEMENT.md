# COPEC Offline/Online — déploiement recommandé (~50 utilisateurs)

## Architecture

Un PC dédié de l'établissement joue le rôle de **serveur local**. Les autres PC se connectent à son adresse IP via le réseau LAN/Wi-Fi. Le serveur local possède PostgreSQL et l'API COPEC. Il continue de fonctionner lorsque l'Internet est coupé.

```text
                  INTERNET
                     │
                    NEON
                     ↕
                Auto-Sync
                     ↕
             SERVEUR COPEC LOCAL
             PostgreSQL + API
                     │
          ┌──────────┼──────────┐
         PC         PC        PC...
              réseau LAN
```

## Matériel conseillé

Pour commencer avec environ 50 utilisateurs :

- CPU 4 cœurs ou mieux
- 8 Go RAM minimum, 16 Go recommandé
- SSD 256 Go ou plus
- Ethernet vers le routeur/switch
- onduleur recommandé
- sauvegarde externe régulière recommandée

## Premier bootstrap

La base locale doit être initialisée avec les données existantes de Neon **avant** le premier usage offline.

Après avoir créé le schéma local et installé `pg_dump`/`psql` :

```bash
export CENTRAL_DATABASE_URL='postgresql://...Neon...'
export LOCAL_DATABASE_URL='postgresql://postgres:...@localhost:5432/gestion_ecole'
./scripts/bootstrap-local-from-neon.sh
```

Ce script copie les données métier existantes sans recopier les tables techniques de synchronisation.

## Neon existant

Sur une base Neon déjà utilisée en production, ne relancez pas `database/schema.sql`, car ce fichier recrée les tables. Installez uniquement :

```bash
psql "$DATABASE_URL" -f scripts/sync-schema-addon.sql
psql "$DATABASE_URL" -f scripts/sync-central-init.sql
```

## Fonctionnement

### Internet disponible

```text
PC → LAN → serveur local → PostgreSQL local
                         ↕
                       Neon
```

### Internet coupé

```text
PC → LAN → serveur local → PostgreSQL local
                         X
                       Neon
```

Les utilisateurs continuent à travailler.

### Internet rétabli

Le worker local pousse les changements locaux puis récupère les changements centraux automatiquement. Aucun import/export manuel n'est nécessaire.

Le worker utilise un curseur, traite les changements par lots de 200 et réessaie automatiquement toutes les 15 secondes par défaut.

## Conflits

Les conflits dangereux ne sont pas écrasés silencieusement. Ils sont conservés dans `sync_conflict` avec :

- opération source ;
- appareil source ;
- table et clé ;
- version locale ;
- version entrante ;
- raison du conflit.

Une interface d'administration de résolution des conflits pourra être ajoutée dans la phase suivante si nécessaire.

## Mobile

Le mobile n'est pas inclus dans cette phase. Le périmètre actuel est volontairement : **PC + serveur local + réseau local + Neon + synchronisation automatique**.
