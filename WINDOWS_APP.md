# COPEC ISAHA — Application Windows

## Option A : PostgreSQL Neon

L'application Windows utilise Electron pour lancer le backend COPEC automatiquement et sert le build React/Vite depuis Express. Aucun Node.js, Docker Desktop, PostgreSQL ou pgAdmin n'est requis sur le PC utilisateur.

### Préparer le PC de développement

```powershell
npm install
npm run frontend:build
npm run desktop:dist
```

L'installeur est généré dans `dist-electron/COPEC-Setup-1.0.0.exe`.

### Première installation

Au premier démarrage, COPEC affiche une fenêtre de configuration :

1. Coller la `DATABASE_URL` PostgreSQL de Neon.
2. Tester la connexion.
3. Enregistrer et démarrer.

Si la base Neon est vide, l'application initialise automatiquement `database/schema.sql` puis `database/seed.sql`. Si les tables COPEC existent déjà, aucune réinitialisation destructive n'est effectuée.

Les secrets JWT et QR sont générés automatiquement et stockés dans le dossier de données Windows de l'application.

### Important — QR des bulletins

Pour que le QR d'un bulletin soit vérifiable depuis un téléphone externe, renseigner une **URL publique HTTPS** qui pointe vers la version web publique de COPEC. `localhost` n'est pas accessible depuis un téléphone.
