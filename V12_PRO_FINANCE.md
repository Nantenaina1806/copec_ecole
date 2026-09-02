# COPEC V12 PRO — Finance / Économe

## Objectif
Transformer le module financier en véritable poste de pilotage : tarifs → génération des frais → encaissement → reçu → caisse → dépenses → clôture → relances → contrôle.

## Règles métier
- Le montant officiel est calculé et validé côté serveur.
- Un paiement appartient obligatoirement au même élève que son frais.
- Un mouvement de caisse doit avoir une pièce source (paiement ou dépense).
- Les frais mensuels sont idempotents : pas de doublon pour élève + année + type + mois.
- Une clôture conserve le solde théorique, le solde réel et l'écart ; aucune correction silencieuse.
- Les opérations sensibles restent protégées par rôle + permission + audit.

## Écrans Économe
1. Pilotage financier : facturé, encaissé, dépenses, recouvrement, impayés, soldes de caisses.
2. Frais & paiements : recherche élève, paiement individuel, paiement groupé séquentiel, reçus.
3. Tarifs : grille par niveau/type/année, génération idempotente des frais.
4. Caisse & dépenses : entrées/sorties, pièces, solde théorique, clôture.
5. Relances : éligibles, historique, relance manuelle.
6. Historique : paiements et mouvements traçables.
7. Contrôle V12 : anomalies d'intégrité et synthèse du jour.
8. Situations élèves : total facturé, payé, solde, frais ouverts et retards.

## API V12
- `GET /finance/controle`
- `GET /finance/situations-eleves?classe_id=&search=`

Toutes les valeurs financières renvoyées par ces endpoints sont issues de PostgreSQL et ne doivent pas être recalculées comme source de vérité dans le frontend.
