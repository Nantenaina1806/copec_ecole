# COPEC V9 — Mise en service

Cette V9 conserve les données existantes et ajoute uniquement des tables/colonnes de sécurité et de livraison.

## 1. Démarrage
Le serveur ne modifie plus le schéma au démarrage : `database/schema.sql` est la source de vérité unique.

## 2. Mot de passe oublié
Depuis `/login`, cliquer sur « Mot de passe oublié ? ».
Le lien reçu expire après 30 minutes et n'est utilisable qu'une fois.

## 3. E-mail réel
Configurer dans `backend/.env` :
- EMAIL_PROVIDER=resend
- RESEND_API_KEY=clé réelle
- EMAIL_FROM=adresse d'envoi vérifiée

## 4. WhatsApp réel
Configurer :
- WHATSAPP_ACCESS_TOKEN=token Meta
- WHATSAPP_PHONE_NUMBER_ID=identifiant du numéro WhatsApp Business
- WHATSAPP_API_VERSION=v23.0

Les messages texte libres WhatsApp peuvent être soumis aux règles de la plateforme Meta; pour les messages initiés hors fenêtre de conversation, utiliser des templates approuvés et adapter l'appel `sendWhatsApp`.

## 5. Données
`schema.sql` contient désormais directement `password_reset_token`, `notification_delivery`, `security_event`, `security_version` et `whatsapp_statut`.
