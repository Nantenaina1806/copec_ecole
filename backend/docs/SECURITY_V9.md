# COPEC V9 — Sécurité & communications

## Authentification
- bcrypt cost 12 pour les nouveaux mots de passe.
- changement de mot de passe exige le mot de passe actuel.
- reset password par token aléatoire SHA-256, valable 30 minutes et à usage unique.
- réponse générique au reset pour éviter l'énumération des comptes.
- `security_version` révoque les JWT existants après changement/réinitialisation.
- rate limiting sur connexion, reset et écritures sensibles.
- Helmet, CORS explicite, validation Zod et assainissement global.

## E-mail
Le backend utilise Resend lorsque `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` et `EMAIL_FROM` sont configurés.
Aucun envoi n'est déclaré comme réussi si le fournisseur n'est pas configuré ou retourne une erreur.

## WhatsApp
Le backend utilise WhatsApp Cloud API de Meta lorsque `WHATSAPP_ACCESS_TOKEN` et `WHATSAPP_PHONE_NUMBER_ID` sont configurés.
Le numéro est normalisé en format international; pour Madagascar, les numéros locaux 032/033/034/037/038 sont convertis en +261.

## Production
Ne jamais mettre les secrets réels dans Git, dans `database/seed.sql`, ni dans le ZIP partagé publiquement. Utiliser des variables d'environnement côté serveur.
