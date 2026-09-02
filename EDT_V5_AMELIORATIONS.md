# Emploi du temps — V5

## Objectif
Rendre les modes **manuel** et **automatique** sûrs, cohérents et sans conflit à l'échelle de toute l'école.

## Renforcements

### Génération automatique
- tient compte des EDT déjà publiés des autres classes ;
- évite les conflits enseignant et salle à l'échelle de l'école ;
- conserve `heures_semaine` et la décomposition 2h/1h ;
- conserve « une matière maximum une fois par jour » ;
- améliore le score pour limiter les trous et répartir les matières ;
- garde un backtracking borné.

### Mode manuel
- pré-contrôle visuel des conflits dans le formulaire ;
- vérification serveur répétée au moment de l'enregistrement ;
- transaction + verrou PostgreSQL contre les courses entre deux utilisateurs ;
- vérification classe / année / matière / enseignant / salle.

### Brouillon → publication
- revalidation côté serveur ;
- brouillon incomplet non publiable ;
- remplacement atomique de l'ancien EDT ;
- rollback automatique si une contrainte échoue.

### Base de données
- FK directe `emploi_du_temps → enseignant_matiere_classe` ;
- trigger contre les chevauchements classe/enseignant/salle ;
- trigger contre deux occurrences de la même matière le même jour.

## Migration
La structure EDT V5 est désormais intégrée directement dans `database/schema.sql`.

La FK est `NOT VALID` au départ. Après contrôle/nettoyage des anciennes données :

```sql
ALTER TABLE emploi_du_temps
  VALIDATE CONSTRAINT fk_edt_enseignant_matiere_classe;
```

## Tests
Moteur EDT : **15/15 tests passés**.

Le build frontend n'a pas pu être exécuté dans l'environnement de préparation car les dépendances npm n'étaient pas installées et `npm ci` a dépassé le délai disponible. Les fichiers backend modifiés passent `node --check`.

## V6 — Pilotage professionnel

- `GET /emploi-du-temps/controle-global` : contrôle des volumes horaires requis vs planifiés + détection globale des conflits.
- `GET /paie/controle-mensuel` : rapprochement EDT → pointage → heures payables → estimation de paie.
- `GET /finance/dashboard` : pilotage facturé / encaissé / dépenses / impayés / soldes de caisse.
- `database/schema.sql` contient désormais directement le snapshot du tarif, les références uniques, le contrôle de paie, la protection des bulletins déjà payés et la vue de solde de caisse.
- Frontend : nouvel onglet « Contrôle mensuel » dans Paie, « Pilotage financier » dans Finances et bouton « Contrôler tout l’EDT » dans Construction.

### Répartition des responsabilités
- **Surveillant** : construction, génération, contrôle et publication de l'EDT ; présence quotidienne.
- **Secrétaire** : élèves, inscriptions, dossiers, bulletins et consultation EDT ; pas d'encaissement.
- **Économe** : frais, paiements, caisse, dépenses, relances et paie ; aucun droit de modifier la structure pédagogique.
- **Enseignant** : consultation de son EDT, présence et consultation de sa propre paie ; aucun accès à la caisse d'un collègue.
- **Admin** : supervision et validation globale.
