# COPEC ISAHA — Guide de Déploiement & Recommandations Pro

Ce document détaille les recommandations d'infrastructure, de sécurité et d'optimisations matérielles/payantes pour assurer un déploiement professionnel à 100% de la solution **COPEC ISAHA**.

---

## 1. Recommandations de Services & Achats Pro (Options Payantes)

### A. Certificat de Signature de Code Windows (Code Signing Certificate)
* **Objectif** : Supprimer le message d'avertissement bleu *"Windows Defender SmartScreen a protégé votre ordinateur"* lors de l'installation du fichier `.exe` sur les ordinateurs de l'école.
* **Prestataires recommandés** : Sectigo, DigiCert, ou SignMyCode (~60$ à 180$/an pour un certificat Standard Code Signing).
* **Configuration** :
  Ajouter dans la section `"win"` de `package.json` ou utiliser les variables d'environnement lors du build :
  ```json
  "win": {
    "certificateFile": "chemin/vers/certificat.pfx",
    "certificatePassword": "MOT_DE_PASSE_CERTIFICAT"
  }
  ```

### B. Stockage Objet Cloud pour les Fichiers & Photos (S3 / Cloudflare R2)
* **Objectif** : Éviter d'enregistrer les photos des élèves, reçus et documents uniquement sur le disque local du serveur (qui peuvent être perdus lors d'un redéploiement ou crash serveur).
* **Solution recommandée** : **Cloudflare R2** (Compatible AWS S3 API, 10 Go gratuits par mois, 0$ de frais de bande passante/egress).
* **Alternative** : AWS S3 ou Wasabi Storage.

### C. Base de Données Cloud (Neon PostgreSQL Pro)
* **Objectif** : Assurer des sauvegardes automatiques en temps réel et gérer un nombre élevé de connexions simultanées (parents/élèves consultant les bulletins).
* **Recommandation** : Si vous utilisez Neon (Neon.tech), souscrire à l'offre **Scale Tier** pour activer :
  * Le Connection Pooling automatique (PgBouncer intégrè).
  * Les sauvegardes automatiques Point-in-Time Restore (PITR) jusqu'à 30 jours.

### D. Nom de Domaine & Certificat SSL (HTTPS)
* **Objectif** : Sécuriser les communications entre l'application mobile, desktop et le backend API.
* **Exemple** : `https://api.copec-ecole.mg`
* **Certificat SSL** : Gratuit via **Let's Encrypt** (Certbot) sur votre serveur Reverse Proxy (Nginx / Caddy / Traefik).

---

## 2. Déploiement Production du Backend (Node.js + Express)

### Utilisation de PM2 (Process Manager)

Le backend inclut désormais le fichier de configuration [ecosystem.config.js](file:///c:/Users/EUGEENE/Desktop/COPEC/backend/ecosystem.config.js).

1. **Installation de PM2 sur le serveur** :
   ```bash
   npm install -g pm2
   ```

2. **Démarrage en mode Production Cluster** :
   ```bash
   cd backend
   pm2 start ecosystem.config.js --env production
   ```

3. **Sauvegarde et Démarrage Automatique au Reboot Serveur** :
   ```bash
   pm2 save
   pm2 startup
   ```

4. **Variables d'environnement indispensables (`backend/.env`)** :
   ```env
   NODE_ENV=production
   PORT=4000
   JWT_SECRET=UnSecretTresSecuriseEtLongDAuMoins32Caracteres!
   BULLETIN_QR_SECRET=UnDeuxiemeSecretTresSecuriseEtLongDAuMoins32Caracteres!
   SYNC_SHARED_SECRET=CleDeSynchronisationPartageeEntreCentralEtMobile!
   DATABASE_URL=postgresql://... (URL Neon ou PostgreSQL local)
   FRONTEND_URL=https://app.copec-ecole.mg
   APP_TIMEZONE=Indian/Antananarivo
   ```

---

## 3. Déploiement Mobile Android (Capacitor)

### Génération de l'APK Signé de Production

1. **Compilation du Frontend** :
   ```bash
   cd frontend
   npm run build
   ```

2. **Copie des assets et mise à jour Capacitor** :
   ```bash
   cd ../mobile
   npx cap copy android
   npx cap sync android
   ```

3. **Génération du Bundle / APK Signé** :
   * Ouvrir Android Studio : `npx cap open android`
   * Menu : **Build > Generate Signed Bundle / APK**
   * Choisir la clé de signature Java (`keystore`) de votre organisation Sekoly/COPEC.

---

## 4. Maintenance & Sauvegardes

* **Sauvegarde manuelle rapide (Base locale)** :
  ```cmd
  backup-database.bat
  ```
* **Sauvegarde automatique (Linux VPS Cron)** :
  ```bash
  0 2 * * * pg_dump -U postgres gestion_ecole | gzip > /backups/copec_$(date +\%Y\%m\%d).sql.gz
  ```
