# Vérification des données

Le package contient le frontend professionnel + backend + SQL de données.

## Contrôles effectués dans le package

- archive ZIP valide ;
- `schema.sql` présent ;
- `seed.sql` présent ;
- copies verbatim de la source reçue présentes ;
- routes backend présentes ;
- pages frontend présentes ;
- fichiers JS backend vérifiés syntaxiquement avec `node --check`.

## Contrôle réel des tables PostgreSQL

À exécuter après configuration de `DATABASE_URL` :

```bash
cd backend
npm install
npm run db:setup
npm run db:verify
```

`db:verify` affiche les nombres de lignes de plusieurs tables pour confirmer que les données sont réellement chargées.
