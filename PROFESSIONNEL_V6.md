# COPEC — Passage vers un pilotage professionnel V6

## 1. Emploi du temps
Le générateur reste la source de proposition, mais la publication doit être précédée par un contrôle global.

### Contraintes dures
- un enseignant ne peut pas avoir deux cours qui se chevauchent ;
- une classe ne peut pas avoir deux cours qui se chevauchent ;
- une salle ne peut pas être utilisée simultanément ;
- l'enseignant doit être affecté à la matière + classe + année ;
- les heures de chaque matière sont comparées à `classe_matiere.heures_semaine`.

### Workflow recommandé
`Générer → contrôler → aperçu → enregistrer brouillon → recontrôler → publier`.

Le bouton **Contrôler tout l'EDT** fournit les déficits, surplus et conflits avant publication.

## 2. Paie horaire enseignant
Le système distingue :
- heures planifiées ;
- heures effectivement pointées ;
- heures absentes ;
- heures en attente de validation ;
- heures payables.

Pour une grille horaire :
`heures_payables × tarif_horaire = montant des heures normales`.

Le tarif utilisé au moment de la préparation est sauvegardé dans `tarif_horaire_snapshot`. Une modification future de la grille ne réécrit donc pas un bulletin historique.

Un bulletin **payé** ne peut plus être modifié silencieusement sur ses données financières principales. Une régularisation doit passer par une procédure explicite.

## 3. Finance élèves
Le module financier conserve la séparation :
- facturation (`frais_scolaire`) ;
- encaissement (`paiement`) ;
- caisse (`mouvement_caisse`) ;
- dépenses (`depense`) ;
- relances (`relance_impaye`).

Le nouveau tableau de pilotage consolide les indicateurs sans déplacer le calcul financier dans le navigateur.

## 4. Rôles
- **Admin** : supervision totale.
- **Surveillant** : opérations pédagogiques quotidiennes et EDT.
- **Secrétaire** : administration des élèves/dossiers/bulletins selon les droits existants.
- **Économe** : opérations financières et paie.
- **Enseignant** : son activité et sa propre paie uniquement.

## 5. Migration
Sur une base existante, appliquer :
`database/schema.sql`

Puis tester :
1. contrôle global EDT ;
2. génération automatique ;
3. ajout manuel d'un cours en conflit ;
4. contrôle mensuel paie ;
5. génération d'une paie horaire ;
6. encaissement et solde de caisse ;
7. clôture de caisse.
