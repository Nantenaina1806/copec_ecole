# COPEC V12 PRO — Spécification complète

## 1. Principe
COPEC V12 transforme les modules existants en workflows professionnels. Le backend est la source de vérité : authentification → rôle → permission → contrôle de ressource → règle métier → transaction PostgreSQL → audit.

## 2. Espaces utilisateurs
### Administrateur
Pilotage global, utilisateurs/permissions, année scolaire, classes/niveaux, sécurité, audit, statistiques, rapports, sauvegardes et supervision des anomalies.

### Secrétaire
Admissions, inscriptions, dossiers élèves, responsables, documents, certificats, affectations et historique administratif. Un dossier incomplet doit être visible avant validation.

### Économe
Pilotage financier, grille tarifaire, génération idempotente des frais, paiements individuels et groupés, reçus, situations élèves, caisse, dépenses, clôtures, relances, contrôle d'intégrité et historique.

### Enseignant
Emploi du temps, cours, présences, notes, devoirs, résultats, bulletins et communication. Les notes sont validées selon classe + matière + période + affectation.

### Surveillant
Présences, retards, absences, justificatifs, suivi des élèves et alertes de vie scolaire.

### Accueil
Recherche limitée, accueil visiteurs, entrées/sorties, orientation et informations administratives minimales. Aucun accès aux notes, paiements ou données confidentielles non nécessaires.

### Élève
Portal personnel : emploi du temps, notes, moyenne, devoirs, absences, bulletins, documents, actualités et messages.

### Parent
Portal multi-enfants : notes, absences, EDT, devoirs, bulletins, situation financière, documents et messages. Les informations sont filtrées par les enfants rattachés au compte.

## 3. Finance / Économe — workflow de référence
Tarifs → génération des frais → contrôle des doublons → encaissement → reçu officiel → mouvement de caisse → rapprochement → relance → clôture → audit.

### Contrôles V12
- Aucun paiement ne peut dépasser le solde restant d'un frais.
- Le paiement doit appartenir au même élève que le frais.
- Un mouvement de caisse ne peut avoir deux pièces sources.
- Un mouvement financier doit être traçable.
- Les frais mensuels sont idempotents par élève/année/type/mois.
- Une clôture ne modifie jamais silencieusement l'historique.
- Les numéros REC/DEP sont séquentiels et auditables.
- Les soldes officiels sont calculés côté serveur/PostgreSQL.

### Tableau Économe
1. Pilotage : facturé, encaissé, dépenses, recouvrement, impayés, soldes de caisse.
2. Frais & paiements : recherche, statut, retard, paiement individuel, paiement groupé séquentiel, reçu.
3. Tarifs : grille par niveau/type/année et génération automatique.
4. Caisse & dépenses : pièces, entrées/sorties, solde théorique, clôtures.
5. Relances : éligibles, historique, relance manuelle.
6. Historique : paiements et mouvements.
7. Contrôle : anomalies et situation financière des élèves.

## 4. Algorithmes
### Moyennes
Moyenne matière = somme(note × coefficient) / somme(coefficients).
Moyenne générale = somme(moyenne matière × coefficient matière) / somme(coefficients matière).

### Paiement groupé
Les frais sont triés par ancienneté. Le montant est affecté du plus ancien au plus récent, jamais au-delà du solde restant. Tout surplus est explicitement retourné comme non affecté.

### Caisse
Solde théorique = solde initial + entrées − sorties.
Écart de clôture = solde réel − solde théorique.
L'écart est conservé et n'est jamais utilisé comme correction silencieuse.

### EDT
Une même ressource ne peut pas être réservée simultanément par deux cours : enseignant, classe ou salle.

## 5. Frontend
- Navigation et actions adaptées au rôle.
- États loading/error/empty/success homogènes.
- Recherche avec debounce et pagination côté serveur lorsque nécessaire.
- Formulaires avec validation immédiate mais validation métier toujours côté backend.
- Responsive desktop/tablette/mobile.
- Refactor progressif des écrans monolithiques en sous-composants métier.

## 6. API V12 ajoutée
- `GET /finance/controle` : contrôles automatiques et indicateurs du jour.
- `GET /finance/situations-eleves` : situation financière consolidée par élève, avec recherche et filtre classe.

## 7. Base de données
L'ancienne migration `database/migrations/V12_PRO_FINANCE_INTEGRITY.sql` (additive, renforce l'intégrité) est désormais entièrement fusionnée dans `database/schema.sql` canonique (triggers de vérification paiement/mouvement de caisse + index associés).

## 8. Tests / déploiement
Avant production : installer les dépendances avec `npm ci` dans `frontend` et `backend`, exécuter le build frontend, les tests backend, puis appliquer le schéma/migration sur une base de préproduction et vérifier les comptes de démonstration.
