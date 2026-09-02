# COPEC ISAHA — Version Windows

## Ce qui a été ajouté

- Electron pour transformer le projet en application Windows.
- Backend Node/Express lancé automatiquement dans l'application.
- Frontend React/Vite servi directement par le backend en mode desktop.
- Assistant de première configuration pour la base PostgreSQL Neon.
- Aucun Node.js, PostgreSQL, pgAdmin, Docker Desktop ou npm n'est requis sur le PC qui utilise le `.exe`.
- Les fichiers uploadés et les sauvegardes locales sont stockés dans le dossier de données Windows de COPEC.
- Les secrets JWT et QR sont générés automatiquement lors de la première configuration.

## Construire l'installeur

Sur un PC Windows avec Node.js installé pour le développement :

```powershell
npm install
cd frontend
npm install
cd ..
npm run desktop:dist
```

Ou double-cliquez sur :

```text
build-windows.bat
```

Le résultat est :

```text
dist-electron\COPEC-Setup-1.0.0.exe
```

## Installer sur un autre ordinateur

Copiez uniquement `COPEC-Setup-1.0.0.exe` sur l'autre ordinateur et installez-le.

Au premier démarrage, collez la `DATABASE_URL` fournie par Neon. L'application teste la connexion et, si la base est vide, installe automatiquement le schéma et les données initiales COPEC.

## Données partagées entre plusieurs PC

Tous les PC configurés avec la même `DATABASE_URL` Neon utilisent la même base centrale. Les données élèves, enseignants, paiements, absences, pointages, bulletins, etc. sont donc centralisées.

## QR bulletin

Une URL publique HTTPS doit être renseignée pour la vérification QR depuis un téléphone. Une URL `localhost` ne fonctionne que sur le PC lui-même.
