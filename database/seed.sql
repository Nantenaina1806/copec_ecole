-- ============================================================
-- BASE DE DONNÉES : COPEC ISAHA — GESTION ÉCOLE
-- DONNÉES FOURNIES DANS LA BASE SOURCE (seed.sql) (à exécuter APRÈS schema.sql)
-- Comptes créés (mot de passe à définir via backend/scripts/reset-demo-passwords.js) :
--   admin@ecole.mg, jean.rakoto@ecole.mg, marie.rabe@ecole.mg, ... (voir README)
-- ============================================================
-- Usage :
--   psql "$DATABASE_URL" -f database/schema.sql
--   psql "$DATABASE_URL" -f database/seed.sql
-- ============================================================

BEGIN;

INSERT INTO parametre_ecole (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Coordonnées réelles de l'établissement (affiche "Réinscriptions/Inscriptions 2026-2027"
-- du Lycée COPEC Mangabe, Fianarantsoa) : remplace les valeurs par défaut de schema.sql,
-- affichées dans l'en-tête de l'appli et sur les reçus de paiement imprimés (voir
-- printRecuPaiement, frontend/src/utils/exportUtils.js). adresse laissée volontairement
-- courte (ville uniquement) : l'adresse complète n'apparaît pas sur l'affiche source —
-- à compléter dans Paramètres dès qu'elle est connue.
UPDATE parametre_ecole SET
  nom_ecole = 'LYCEE COPEC MANGABE',
  adresse = 'Fianarantsoa',
  telephone = '034 81 545 98',
  email = 'copecfianar@gmail.com'
WHERE id = 1;

-- ============================================================
-- DONNÉES DE RÉFÉRENCE
-- ============================================================
INSERT INTO cycle (id, nom, ordre) VALUES
(1,'Primaire',1),(2,'Collège',2),(3,'Secondaire',3);

INSERT INTO niveau (id, cycle_id, nom, ordre) VALUES
(1,1,'PS',1),(2,1,'CP',2),(3,1,'CE1',3),(4,1,'CE2',4),(5,1,'CM1',5),(6,1,'CM2',6),
(7,2,'6eme',1),(8,2,'5eme',2),(9,2,'4eme',3),(10,2,'3eme A',4),(11,2,'3eme B',5),
(12,3,'2nde',1),(13,3,'1ere L',2),(14,3,'1ere S',3),(15,3,'Terminale D',4),(16,3,'Terminale A2',5);


-- Données de référence : permissions et affectations initiales des rôles.
INSERT INTO permission (code, libelle, module) VALUES
('eleves.read','Consulter les élèves','scolarite'),('eleves.write','Créer/modifier les élèves','scolarite'),
('inscriptions.write','Gérer les inscriptions','scolarite'),('notes.write','Saisir/modifier les notes','pedagogie'),
('bulletins.generate','Générer les bulletins','pedagogie'),('bulletins.publish','Publier les bulletins','pedagogie'),
('presence.write','Gérer les présences','vie_scolaire'),('finance.read','Consulter la finance','finance'),
('finance.write','Enregistrer les opérations financières','finance'),('finance.close','Clôturer la caisse','finance'),
('paie.read','Consulter la paie','rh'),('paie.write','Préparer/valider la paie','rh'),
('documents.read','Consulter les documents','documents'),('documents.write','Déposer/supprimer des documents','documents'),
('parents.read','Consulter les parents','communication'),('messages.write','Envoyer des messages','communication'),
('reports.read','Consulter les rapports','pilotage'),('audit.read','Consulter l''audit','securite'),
('users.manage','Gérer les comptes','administration'),('settings.manage','Gérer les paramètres','administration'),
('visiteurs.write','Gérer le registre visiteurs','accueil') ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permission(role, permission_id)
SELECT v.role, p.id FROM (VALUES
('admin','%'),('enseignant','eleves.read'),('enseignant','notes.write'),('enseignant','presence.write'),
('secretaire','eleves.read'),('secretaire','eleves.write'),('secretaire','inscriptions.write'),('secretaire','bulletins.generate'),('secretaire','documents.read'),('secretaire','documents.write'),('secretaire','parents.read'),
('economie','finance.read'),('economie','finance.write'),('economie','finance.close'),('economie','paie.read'),('economie','paie.write'),
('surveillant','eleves.read'),('surveillant','presence.write'),('surveillant','documents.read'),('surveillant','visiteurs.write'),
('accueil','eleves.read'),('accueil','parents.read'),('accueil','visiteurs.write')) v(role, code)
JOIN permission p ON (v.code='%' OR p.code=v.code) ON CONFLICT DO NOTHING;

INSERT INTO annee_scolaire (libelle,date_debut,date_fin,actif) VALUES
('2024-2025',DATE '2024-09-01',DATE '2025-06-30',FALSE),
('2025-2026',DATE '2025-09-01',DATE '2026-06-30',TRUE);

INSERT INTO bimestre (id,annee_scolaire_id,numero,libelle,date_debut,date_fin,actif) VALUES
(1,2,1,'Bimestre 1',DATE '2025-09-01',DATE '2025-10-31',TRUE),
(2,2,2,'Bimestre 2',DATE '2025-11-01',DATE '2025-12-20',FALSE),
(3,2,3,'Bimestre 3',DATE '2026-01-05',DATE '2026-02-28',FALSE),
(4,2,4,'Bimestre 4',DATE '2026-03-01',DATE '2026-04-30',FALSE),
(5,2,5,'Bimestre 5',DATE '2026-05-01',DATE '2026-06-30',FALSE);

INSERT INTO matiere (nom,code,coefficient) VALUES
('Mathématiques','MATH',4),('Français','FR',4),('Anglais','ANG',3),('Malagasy','MALG',3),('Physique-Chimie','PC',4),('SVT','SVT',3),
('Histoire-Géographie','HG',3),('Éducation Civique','EDC',1),('Éducation Physique et Sportive','EPS',1),
('Éducation Artistique','ART',1),('Musique','MUS',1),('Informatique','INFO',2),('Philosophie','PHILO',3),
('Économie','ECO',2),('Activités d''Éveil','EVEIL',2),('Graphisme-Écriture','GRAPH',2),('Travaux Manuels','TM',1);

-- Matière "vata-jo" (générique) réservée au cycle Primaire : le Collège/Secondaire garde la
-- logique matière × classe (matrice Affectations, heures_semaine, génération auto d'EDT), mais
-- au Primaire un seul titulaire couvre tout, sans matière ni heures à répartir. Cette matière
-- sert uniquement de support technique aux tables classe_matiere / enseignant_matiere(_classe) /
-- emploi_du_temps pour cette classe (voir backend/src/services/primaireService.js), elle n'est
-- jamais proposée dans la matrice d'affectations ni comme colonne de matière (code PRIMGEN
-- reconnu et filtré explicitement côté frontend).
INSERT INTO matiere (nom,code,coefficient) VALUES ('Enseignement Primaire','PRIMGEN',1);

INSERT INTO utilisateur (nom,prenom,email,mot_de_passe,role,telephone,adresse,actif) VALUES
('Nantenaina','Eugène','admin@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','admin','0340000000','Fianarantsoa',TRUE),
('RAKOTO','Jean','jean.rakoto@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000001','Antananarivo',TRUE),
('RABE','Marie','marie.rabe@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000002','Antananarivo',TRUE),
('RANDRIA','Paul','paul.randria@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000003','Antananarivo',TRUE),
('RAZAFY','Claire','claire.razafy@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000004','Antananarivo',TRUE),
('ANDRIAMBOLOLONA','Hery','hery.andriambololona@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000005','Antananarivo',TRUE),
('RAKOTONIAINA','Sophie','sophie.rakotoniaina@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000006','Antananarivo',TRUE),
('RAKOTOMALALA','Michel','michel.rakotomalala@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000007','Antananarivo',TRUE),
('ANDRIANINA','Luc','luc.andrianina@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000008','Antananarivo',TRUE),
('RAZANAKOLONA','Herizo','herizo.razanakolona@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000009','Mahajanga',TRUE),
('ANDRIAMIHAJA','Voninavoko','voninavoko.andriamihaja@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000010','Antananarivo',TRUE),
('RASOLOFONIAINA','Tahina','tahina.rasolofoniaina@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000011','Fianarantsoa',TRUE),
('RAKOTOARISOA','Fenosoa','fenosoa.rakotoarisoa@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000012','Antsirabe',TRUE),
('RANDRIAMANANTENA','Andry','andry.randriamanantena@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000013','Toamasina',TRUE),
('RAZAFINDRAKOTO','Nirina','nirina.razafindrakoto@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000014','Antananarivo',TRUE),
('ANDRIANARIVELO','Fanja','fanja.andrianarivelo@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000015','Fianarantsoa',TRUE),
('RAZAFIMAHEFA','Tiana','tiana.razafimahefa@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000016','Antsirabe',TRUE),
('RAKOTOVAO','Mamy','mamy.rakotovao@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000017','Toamasina',TRUE),
('RASOAMANANA','Hary','hary.rasoamanana@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000018','Mahajanga',TRUE),
('ANDRIANTSOA','Faniry','faniry.andriantsoa@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000019','Antananarivo',TRUE),
('RAKOTOZAFY','Mialy','mialy.rakotozafy@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000020','Fianarantsoa',TRUE),
('RAVELOJAONA','Rivo','rivo.ravelojaona@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000021','Antsirabe',TRUE),
('RASOLONIRINA','Zo','zo.rasolonirina@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000022','Toamasina',TRUE),
('ANDRIAMORA','Ony','ony.andriamora@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000023','Mahajanga',TRUE),
('RAKOTONDRABE','Hasina','hasina.rakotondrabe@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000024','Antananarivo',TRUE),
('RAZAFINDRAVAO','Lala','lala.razafindravao@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000025','Fianarantsoa',TRUE),
('RANDRIANASOLO','Nomena','nomena.randrianasolo@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000026','Antsirabe',TRUE),
('RAKOTOARIMANANA','Sitraka','sitraka.rakotoarimanana@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000027','Toamasina',TRUE),
('ANDRIANJAKA','Tojo','tojo.andrianjaka@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000028','Mahajanga',TRUE),
('RASOARIMALALA','Vola','vola.rasoarimalala@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000029','Antananarivo',TRUE),
('RAZAFINDRAZAKA','Zara','zara.razafindrazaka@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000030','Fianarantsoa',TRUE),
('RAKOTOMANGA','Miora','miora.rakotomanga@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000031','Antsirabe',TRUE),
('RAVOLOLONA','Dera','dera.ravololona@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000032','Toamasina',TRUE),
('ANDRIANAIVO','Nasandratra','nasandratra.andrianaivo@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000033','Mahajanga',TRUE),
('RAKOTOARINIAINA','Feno','feno.rakotoariniaina@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000034','Antananarivo',TRUE),
('RASOLOARIMALALA','Iarivo','iarivo.rasoloarimalala@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000035','Fianarantsoa',TRUE),
('RANDRIANARISOA','Solofo','solofo.randrianarisoa@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000036','Antsirabe',TRUE),
('RAZANADRAKOTO','Toky','toky.razanadrakoto@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000037','Toamasina',TRUE),
('ANDRIAMBOLOLONTSOA','Mbola','mbola.andriambololontsoa@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000038','Mahajanga',TRUE),
('RAKOTOSEHENO','Herinjaka','herinjaka.rakotoseheno@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000039','Antananarivo',TRUE),
('RASENDRAVOLA','Volatiana','volatiana.rasendravola@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000040','Fianarantsoa',TRUE),
('RANDRIANJAFY','Ndriana','ndriana.randrianjafy@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000041','Antsirabe',TRUE),
('RAZAFINIAINA','Falisoa','falisoa.razafiniaina@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000042','Toamasina',TRUE),
('ANDRIANOMENJANAHARY','Manda','manda.andrianomenjanahary@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000043','Mahajanga',TRUE),
('RAKOTOMAVO','Njara','njara.rakotomavo@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000044','Antananarivo',TRUE),
('RASOAZANAMANGA','Onja','onja.rasoazanamanga@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000045','Fianarantsoa',TRUE),
('RANDRIAMBOLOLONA','Sedera','sedera.randriambololona@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000046','Antsirabe',TRUE),
('RAZAFINDRAINIBE','Tsiory','tsiory.razafindrainibe@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000047','Toamasina',TRUE),
('ANDRIANARISON','Zafy','zafy.andrianarison@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000048','Mahajanga',TRUE),
('RAKOTOZANANY','Iharisoa','iharisoa.rakotozanany@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000049','Antananarivo',TRUE),
('RASOLONJATOVO','Ravaka','ravaka.rasolonjatovo@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','enseignant','0340000050','Fianarantsoa',TRUE);

INSERT INTO agent (nom,prenom,email,mot_de_passe,role_agent,telephone,adresse,actif) VALUES
('Rasolofo','Nirina','secretaire@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','secretaire','0330000001','Fianarantsoa',TRUE),
('Andrianary','Toky','accueil@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','accueil','0330000002','Fianarantsoa',TRUE),
('Rasoanaivo','Voahangy','economie@ecole.mg','$2a$10$taSQi0at5sQhB/ew0Zo79ORh6Wic/1CNnymkW3PnONWhm0Bi0peJK','economie','0330000003','Fianarantsoa',TRUE);

UPDATE utilisateur
SET mot_de_passe = '$2a$10$AlINjMiUjGDibCXnXlCgkuWZ7CURiJtTns1ZeJpatUUZhB55PkN3O', compte_confirme = TRUE
WHERE email IN ('admin@ecole.mg', 'luc.andrianina@ecole.mg');

UPDATE agent
SET mot_de_passe = '$2a$10$AlINjMiUjGDibCXnXlCgkuWZ7CURiJtTns1ZeJpatUUZhB55PkN3O'
WHERE email IN ('secretaire@ecole.mg', 'accueil@ecole.mg', 'economie@ecole.mg');

-- ============================================================
-- CLASSES + MATIÈRES + AFFECTATIONS
-- ============================================================
INSERT INTO classe (nom,niveau_id,filiere,salle,titulaire_id,annee_scolaire_id,capacite)
SELECT v.nom,v.niveau,v.filiere,v.salle,t.titulaire_id,a.id,40
FROM (VALUES
('PS',1,NULL,'salle_PS','herizo.razanakolona@ecole.mg'),
('CP',2,NULL,'salle_CP','marie.rabe@ecole.mg'),
('CE1',3,NULL,'Salle CE1','voninavoko.andriamihaja@ecole.mg'),
('CE2',4,NULL,'Salle CE2','tahina.rasolofoniaina@ecole.mg'),
('CM1',5,NULL,'Salle CM1','fenosoa.rakotoarisoa@ecole.mg'),
('CM2',6,NULL,'salle_CM2','jean.rakoto@ecole.mg'),
('6eme',7,NULL,'Salle 6eme','paul.randria@ecole.mg'),
('5eme',8,NULL,'Salle 5eme','claire.razafy@ecole.mg'),
('4eme',9,NULL,'Salle 4eme','hery.andriambololona@ecole.mg'),
('3eme A',10,NULL,'Salle 3eme A','sophie.rakotoniaina@ecole.mg'),
('3eme B',11,NULL,'Salle 3eme B',NULL),
('2nde',12,NULL,'Salle 2nde','michel.rakotomalala@ecole.mg'),
('1ere L',13,'Littéraire','Salle 1ere L',NULL),
('1ere S',14,'Scientifique','Salle 1ere S','luc.andrianina@ecole.mg'),
('Terminale D',15,'Série D','Salle Terminale D',NULL),
('Terminale A2',16,'Série A2','Salle Terminale A2',NULL)
) v(nom,niveau,filiere,salle,titulaire_email)
JOIN annee_scolaire a ON a.libelle='2025-2026'
LEFT JOIN LATERAL (SELECT id AS titulaire_id FROM utilisateur WHERE email=v.titulaire_email) t ON TRUE;

-- Primaire (PS à CM2) : un seul "poste" par classe, sur la matière vata-jo PRIMGEN — pas de
-- répartition matière par matière (voir backend/src/services/primaireService.js). Le
-- Collège/Secondaire garde la logique classe_matiere complète ci-dessous.
INSERT INTO classe_matiere (classe_id,matiere_id,coefficient,heures_semaine)
SELECT c.id, m.id, 1, 8
FROM classe c
JOIN niveau n ON n.id = c.niveau_id
JOIN cycle cy ON cy.id = n.cycle_id AND cy.nom = 'Primaire'
JOIN matiere m ON m.code = 'PRIMGEN'
WHERE c.annee_scolaire_id = (SELECT id FROM annee_scolaire WHERE libelle = '2025-2026');

INSERT INTO classe_matiere (classe_id,matiere_id,coefficient,heures_semaine)
SELECT c.id,m.id,m.coefficient,v.heures
FROM (VALUES
('6eme','Malagasy',3),
('6eme','Français',4),
('6eme','Anglais',3),
('6eme','Mathématiques',5),
('6eme','Physique-Chimie',3),
('6eme','SVT',3),
('6eme','Histoire-Géographie',3),
('6eme','Éducation Civique',2),
('6eme','Éducation Physique et Sportive',2),
('6eme','Informatique',2),
('6eme','Éducation Artistique',2),
('6eme','Travaux Manuels',2),
('5eme','Malagasy',3),
('5eme','Français',4),
('5eme','Anglais',3),
('5eme','Mathématiques',5),
('5eme','Physique-Chimie',3),
('5eme','SVT',3),
('5eme','Histoire-Géographie',3),
('5eme','Éducation Civique',2),
('5eme','Éducation Physique et Sportive',2),
('5eme','Informatique',2),
('5eme','Éducation Artistique',2),
('5eme','Travaux Manuels',2),
('4eme','Malagasy',3),
('4eme','Français',4),
('4eme','Anglais',3),
('4eme','Mathématiques',4),
('4eme','Physique-Chimie',3),
('4eme','SVT',3),
('4eme','Histoire-Géographie',3),
('4eme','Éducation Civique',2),
('4eme','Éducation Physique et Sportive',2),
('4eme','Informatique',2),
('3eme A','Malagasy',3),
('3eme A','Français',4),
('3eme A','Anglais',3),
('3eme A','Mathématiques',4),
('3eme A','Physique-Chimie',3),
('3eme A','SVT',3),
('3eme A','Histoire-Géographie',3),
('3eme A','Éducation Civique',2),
('3eme A','Éducation Physique et Sportive',2),
('3eme A','Informatique',2),
('3eme B','Malagasy',3),
('3eme B','Français',4),
('3eme B','Anglais',3),
('3eme B','Mathématiques',4),
('3eme B','Physique-Chimie',3),
('3eme B','SVT',3),
('3eme B','Histoire-Géographie',3),
('3eme B','Éducation Civique',2),
('3eme B','Éducation Physique et Sportive',2),
('3eme B','Informatique',2),
('2nde','Malagasy',2),
('2nde','Français',3),
('2nde','Anglais',3),
('2nde','Mathématiques',6),
('2nde','Physique-Chimie',4),
('2nde','SVT',3),
('2nde','Histoire-Géographie',2),
('2nde','Éducation Physique et Sportive',2),
('2nde','Informatique',2),
('1ere L','Malagasy',3),
('1ere L','Français',3),
('1ere L','Anglais',3),
('1ere L','Mathématiques',3),
('1ere L','Histoire-Géographie',4),
('1ere L','Philosophie',4),
('1ere L','Économie',3),
('1ere L','Éducation Physique et Sportive',2),
('Terminale A2','Malagasy',3),
('Terminale A2','Français',3),
('Terminale A2','Anglais',3),
('Terminale A2','Mathématiques',3),
('Terminale A2','Histoire-Géographie',4),
('Terminale A2','Philosophie',4),
('Terminale A2','Économie',3),
('Terminale A2','Éducation Physique et Sportive',2),
('1ere S','Malagasy',2),
('1ere S','Français',2),
('1ere S','Anglais',3),
('1ere S','Mathématiques',6),
('1ere S','Physique-Chimie',6),
('1ere S','SVT',3),
('1ere S','Philosophie',3),
('1ere S','Éducation Physique et Sportive',2),
('Terminale D','Malagasy',2),
('Terminale D','Français',2),
('Terminale D','Anglais',3),
('Terminale D','Mathématiques',6),
('Terminale D','Physique-Chimie',6),
('Terminale D','SVT',3),
('Terminale D','Philosophie',3),
('Terminale D','Éducation Physique et Sportive',2)
) v(classe_nom,matiere_nom,heures)
JOIN classe c ON c.nom=v.classe_nom AND c.annee_scolaire_id=(SELECT id FROM annee_scolaire WHERE libelle='2025-2026')
JOIN matiere m ON m.nom=v.matiere_nom;

INSERT INTO enseignant_matiere (enseignant_id,matiere_id,annee_scolaire_id)
SELECT u.id,m.id,2 FROM (VALUES
('jean.rakoto@ecole.mg','Mathématiques'),('jean.rakoto@ecole.mg','Français'),
('marie.rabe@ecole.mg','Malagasy'),('marie.rabe@ecole.mg','Français'),
('paul.randria@ecole.mg','Mathématiques'),('claire.razafy@ecole.mg','Français'),
('hery.andriambololona@ecole.mg','Anglais'),('sophie.rakotoniaina@ecole.mg','SVT'),
('michel.rakotomalala@ecole.mg','Mathématiques'),('luc.andrianina@ecole.mg','Physique-Chimie'),
('andry.randriamanantena@ecole.mg','Anglais'),
('fanja.andrianarivelo@ecole.mg','Éducation Artistique'),
('fenosoa.rakotoarisoa@ecole.mg','Français'),
('fenosoa.rakotoarisoa@ecole.mg','Histoire-Géographie'),
('fenosoa.rakotoarisoa@ecole.mg','Malagasy'),
('fenosoa.rakotoarisoa@ecole.mg','Mathématiques'),
('fenosoa.rakotoarisoa@ecole.mg','SVT'),
('fenosoa.rakotoarisoa@ecole.mg','Éducation Civique'),
('herizo.razanakolona@ecole.mg','Activités d''Éveil'),
('herizo.razanakolona@ecole.mg','Français'),
('herizo.razanakolona@ecole.mg','Graphisme-Écriture'),
('herizo.razanakolona@ecole.mg','Malagasy'),
('herizo.razanakolona@ecole.mg','Mathématiques'),
('jean.rakoto@ecole.mg','Histoire-Géographie'),
('jean.rakoto@ecole.mg','Malagasy'),
('jean.rakoto@ecole.mg','SVT'),
('jean.rakoto@ecole.mg','Éducation Civique'),
('marie.rabe@ecole.mg','Activités d''Éveil'),
('marie.rabe@ecole.mg','Graphisme-Écriture'),
('marie.rabe@ecole.mg','Mathématiques'),
('nirina.razafindrakoto@ecole.mg','Éducation Physique et Sportive'),
('tahina.rasolofoniaina@ecole.mg','Français'),
('tahina.rasolofoniaina@ecole.mg','Histoire-Géographie'),
('tahina.rasolofoniaina@ecole.mg','Malagasy'),
('tahina.rasolofoniaina@ecole.mg','Mathématiques'),
('tahina.rasolofoniaina@ecole.mg','SVT'),
('tahina.rasolofoniaina@ecole.mg','Éducation Civique'),
('tiana.razafimahefa@ecole.mg','Informatique'),
('voninavoko.andriamihaja@ecole.mg','Français'),
('voninavoko.andriamihaja@ecole.mg','Histoire-Géographie'),
('voninavoko.andriamihaja@ecole.mg','Malagasy'),
('voninavoko.andriamihaja@ecole.mg','Mathématiques'),
('voninavoko.andriamihaja@ecole.mg','SVT'),
('voninavoko.andriamihaja@ecole.mg','Éducation Civique')
) v(email,matiere_nom) JOIN utilisateur u ON u.email=v.email JOIN matiere m ON m.nom=v.matiere_nom;

-- Primaire : le titulaire de chaque classe est la seule personne "affectée" (RG-011, sur la
-- matière vata-jo PRIMGEN). Les anciens intervenants spécialisés (Anglais/EPS/Éducation
-- Artistique/Informatique) qui n'intervenaient qu'au Primaire n'ont plus de classe ici — ils
-- restent enseignants actifs, disponibles pour une affectation Collège/Secondaire via la page
-- Affectations, mais ne réapparaissent plus automatiquement au Primaire.
INSERT INTO enseignant_matiere (enseignant_id,matiere_id,annee_scolaire_id)
SELECT c.titulaire_id, m.id, c.annee_scolaire_id
FROM classe c
JOIN niveau n ON n.id = c.niveau_id
JOIN cycle cy ON cy.id = n.cycle_id AND cy.nom = 'Primaire'
JOIN matiere m ON m.code = 'PRIMGEN'
WHERE c.annee_scolaire_id = (SELECT id FROM annee_scolaire WHERE libelle = '2025-2026')
  AND c.titulaire_id IS NOT NULL;

ALTER TABLE emploi_du_temps ENABLE TRIGGER trg_edt_no_overlap;

INSERT INTO enseignant_matiere_classe (enseignant_id,matiere_id,classe_id,annee_scolaire_id)
SELECT c.titulaire_id, m.id, c.id, c.annee_scolaire_id
FROM classe c
JOIN niveau n ON n.id = c.niveau_id
JOIN cycle cy ON cy.id = n.cycle_id AND cy.nom = 'Primaire'
JOIN matiere m ON m.code = 'PRIMGEN'
WHERE c.annee_scolaire_id = (SELECT id FROM annee_scolaire WHERE libelle = '2025-2026')
  AND c.titulaire_id IS NOT NULL;

INSERT INTO enseignant_matiere_classe (enseignant_id,matiere_id,classe_id,annee_scolaire_id)
SELECT u.id,m.id,c.id,2 FROM (VALUES
('paul.randria@ecole.mg','Mathématiques','6eme'),('claire.razafy@ecole.mg','Français','6eme'),
('hery.andriambololona@ecole.mg','Anglais','6eme'),('paul.randria@ecole.mg','Mathématiques','5eme'),
('sophie.rakotoniaina@ecole.mg','SVT','5eme'),('claire.razafy@ecole.mg','Français','5eme'),
('michel.rakotomalala@ecole.mg','Mathématiques','2nde'),('luc.andrianina@ecole.mg','Physique-Chimie','2nde'),
('michel.rakotomalala@ecole.mg','Mathématiques','1ere S'),('luc.andrianina@ecole.mg','Physique-Chimie','1ere S')
) v(email,matiere_nom,classe_nom) JOIN utilisateur u ON u.email=v.email JOIN matiere m ON m.nom=v.matiere_nom JOIN classe c ON c.nom=v.classe_nom AND c.annee_scolaire_id=2;

-- ============================================================
-- ÉLÈVES + INSCRIPTIONS + PARENTS
-- ============================================================
INSERT INTO eleve (matricule,nom,prenom,date_naissance,sexe,adresse,telephone,email,numero_carte,qr_code_data)
SELECT 'EL-'||c.nom||'-'||g.n,'Rakoto'||g.n,'Eleve'||g.n,DATE '2010-01-01'+(c.id*20+g.n),CASE WHEN g.n=1 THEN 'F' ELSE 'M' END,
       'Adresse '||g.n,'03410000'||LPAD((c.id*2+g.n)::text,2,'0'),'eleve_'||replace(c.nom,' ','_')||'_'||g.n||'@ecole.mg',
       'CARTE-'||c.nom||'-'||g.n,'QR-'||c.nom||'-'||g.n
FROM classe c CROSS JOIN generate_series(1,2) g(n);

INSERT INTO inscription (eleve_id,classe_id,annee_scolaire_id,numero_classe,statut)
SELECT e.id,c.id,2,g.n,'inscrit' FROM classe c CROSS JOIN generate_series(1,2) g(n)
JOIN eleve e ON e.matricule='EL-'||c.nom||'-'||g.n;

INSERT INTO parent (nom,prenom,telephone,email,adresse,actif)
SELECT 'Parent-'||e.nom,'Responsable-'||e.prenom,'034200'||LPAD(e.id::text,4,'0'),'parent_'||e.id||'@ecole.mg',e.adresse,TRUE
FROM eleve e;

-- NB : jointure sur l'email généré ('parent_'||e.id||'@ecole.mg'), pas sur l'égalité des id.
-- parent.id et eleve.id sont des séquences indépendantes ; les faire coïncider par hasard
-- d'ordre d'insertion est fragile (tout INSERT/DELETE antérieur dans l'une des deux tables
-- décale les id et associe le mauvais parent au mauvais élève).
INSERT INTO eleve_parent (eleve_id,parent_id,lien_parente,responsable_principal,autorise_retrait,recoit_notifications)
SELECT e.id,p.id,'tuteur',TRUE,TRUE,TRUE FROM eleve e JOIN parent p ON p.email='parent_'||e.id||'@ecole.mg';

-- ============================================================
-- SALLES — QR code statique par salle + géofence GPS.
-- Coordonnées placeholder (à ajuster par l'admin selon la position réelle de l'école) :
-- toutes les salles partagent ici le même point (un seul établissement, un seul périmètre).
-- ============================================================
INSERT INTO salle (nom, qr_code_data, latitude, longitude, rayon_metres)
SELECT DISTINCT c.salle, 'QR-SALLE-'||md5(c.salle||random()::text), -21.4536, 47.0854, 100
FROM classe c
WHERE c.salle IS NOT NULL;

-- ============================================================
-- EMPLOI DU TEMPS — uniquement avec affectation valide
-- ============================================================
ALTER TABLE emploi_du_temps DISABLE TRIGGER trg_edt_no_overlap;

INSERT INTO emploi_du_temps (classe_id,matiere_id,enseignant_id,annee_scolaire_id,jour,heure_debut,heure_fin,salle,salle_id)
SELECT c.id,m.id,u.id,2,v.jour,v.debut,v.fin,c.salle,s.id
FROM (VALUES
('6eme','Mathématiques','paul.randria@ecole.mg','Lundi',TIME '07:30',TIME '08:30'),
('6eme','Français','claire.razafy@ecole.mg','Mardi',TIME '08:30',TIME '09:30'),
('5eme','Mathématiques','paul.randria@ecole.mg','Lundi',TIME '09:30',TIME '10:30'),
('5eme','SVT','sophie.rakotoniaina@ecole.mg','Mercredi',TIME '10:00',TIME '11:00'),
('2nde','Mathématiques','michel.rakotomalala@ecole.mg','Lundi',TIME '07:30',TIME '08:30'),
('2nde','Physique-Chimie','luc.andrianina@ecole.mg','Mercredi',TIME '10:00',TIME '11:00'),
('1ere S','Mathématiques','michel.rakotomalala@ecole.mg','Mardi',TIME '08:30',TIME '09:30'),
('1ere S','Physique-Chimie','luc.andrianina@ecole.mg','Jeudi',TIME '09:30',TIME '10:30')
) v(classe_nom,matiere_nom,enseignant_email,jour,debut,fin)
JOIN classe c ON c.nom=v.classe_nom AND c.annee_scolaire_id=2
JOIN matiere m ON m.nom=v.matiere_nom
JOIN utilisateur u ON u.email=v.enseignant_email
LEFT JOIN salle s ON s.nom=c.salle;

-- ============================================================
-- EMPLOI DU TEMPS — PRIMAIRE (PS à CM2)
-- Horaire unique et fixe, le même pour toutes les classes primaires : le titulaire couvre
-- seul la classe toute la journée sur la matière vata-jo PRIMGEN (pas de répartition par
-- matière comme au Collège/Secondaire). Lundi à Jeudi : 07:00-11:00 (matin) + 14:00-17:00
-- (après-midi) — Vendredi : 07:00-11:00 uniquement, pas d'après-midi.
-- Générée par produit cartésien classes primaires × créneaux fixes plutôt qu'énumérée ligne
-- par ligne (voir aussi POST /emploi-du-temps/generer-primaire, qui applique la même grille
-- côté application).
-- ============================================================
INSERT INTO emploi_du_temps (classe_id,matiere_id,enseignant_id,annee_scolaire_id,jour,heure_debut,heure_fin,salle,salle_id)
SELECT c.id, m.id, c.titulaire_id, c.annee_scolaire_id, v.jour, v.debut, v.fin, c.salle, s.id
FROM classe c
JOIN niveau n ON n.id = c.niveau_id
JOIN cycle cy ON cy.id = n.cycle_id AND cy.nom = 'Primaire'
JOIN matiere m ON m.code = 'PRIMGEN'
CROSS JOIN (VALUES
  ('Lundi',    TIME '07:00', TIME '11:00'),
  ('Lundi',    TIME '14:00', TIME '17:00'),
  ('Mardi',    TIME '07:00', TIME '11:00'),
  ('Mardi',    TIME '14:00', TIME '17:00'),
  ('Mercredi', TIME '07:00', TIME '11:00'),
  ('Mercredi', TIME '14:00', TIME '17:00'),
  ('Jeudi',    TIME '07:00', TIME '11:00'),
  ('Jeudi',    TIME '14:00', TIME '17:00'),
  ('Vendredi', TIME '07:00', TIME '11:00')
) v(jour,debut,fin)
LEFT JOIN salle s ON s.nom = c.salle
WHERE c.annee_scolaire_id = (SELECT id FROM annee_scolaire WHERE libelle = '2025-2026')
  AND c.titulaire_id IS NOT NULL;

-- ============================================================
-- POINTAGES + NOTES — relations renforcées
-- ============================================================
INSERT INTO pointage_enseignant (enseignant_id,agent_id,emploi_du_temps_id,date_pointage,heure_arrivee,heure_depart,statut)
SELECT e.enseignant_id,a.id,e.id,DATE '2025-09-08',TIME '07:15',TIME '16:00','present'
FROM emploi_du_temps e JOIN agent a ON a.email='accueil@ecole.mg' ORDER BY e.id LIMIT 1;
INSERT INTO pointage_enseignant (enseignant_id,agent_id,emploi_du_temps_id,date_pointage,heure_arrivee,heure_depart,statut)
SELECT e.enseignant_id,a.id,e.id,DATE '2025-09-09',TIME '07:40',TIME '16:00','retard'
FROM emploi_du_temps e JOIN agent a ON a.email='accueil@ecole.mg' ORDER BY e.id OFFSET 1 LIMIT 1;

INSERT INTO pointage_eleve (eleve_id,classe_id,annee_scolaire_id,agent_id,enseignant_id,emploi_du_temps_id,date_pointage,statut)
SELECT e.id,i.classe_id,2,a.id,edt.enseignant_id,edt.id,DATE '2025-09-08','present'
FROM eleve e JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=2
JOIN emploi_du_temps edt ON edt.classe_id=i.classe_id AND edt.annee_scolaire_id=2 AND edt.jour='Lundi'
JOIN agent a ON a.email='accueil@ecole.mg' WHERE e.matricule='EL-CM2-1' ORDER BY edt.id LIMIT 1;
INSERT INTO pointage_eleve (eleve_id,classe_id,annee_scolaire_id,agent_id,enseignant_id,emploi_du_temps_id,date_pointage,statut)
SELECT e.id,i.classe_id,2,a.id,edt.enseignant_id,edt.id,DATE '2025-09-08','absent'
FROM eleve e JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=2
JOIN emploi_du_temps edt ON edt.classe_id=i.classe_id AND edt.annee_scolaire_id=2 AND edt.jour='Lundi'
JOIN agent a ON a.email='accueil@ecole.mg' WHERE e.matricule='EL-CM2-2' ORDER BY edt.id LIMIT 1;

INSERT INTO note (eleve_id,classe_id,matiere_id,enseignant_id,annee_scolaire_id,bimestre_id,note_valeur,type_evaluation)
SELECT e.id,i.classe_id,m.id,emc.enseignant_id,i.annee_scolaire_id,1,15.50,'Devoir'
FROM eleve e
JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=(SELECT id FROM annee_scolaire WHERE libelle='2025-2026')
JOIN matiere m ON m.nom='Mathématiques'
JOIN enseignant_matiere_classe emc
  ON emc.classe_id=i.classe_id
 AND emc.matiere_id=m.id
 AND emc.annee_scolaire_id=i.annee_scolaire_id
WHERE e.matricule='EL-CM2-1'
LIMIT 1;
INSERT INTO note (eleve_id,classe_id,matiere_id,enseignant_id,annee_scolaire_id,bimestre_id,note_valeur,type_evaluation)
SELECT e.id,i.classe_id,m.id,emc.enseignant_id,i.annee_scolaire_id,1,13.00,'Composition'
FROM eleve e
JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=(SELECT id FROM annee_scolaire WHERE libelle='2025-2026')
JOIN matiere m ON m.nom='Français'
JOIN enseignant_matiere_classe emc
  ON emc.classe_id=i.classe_id
 AND emc.matiere_id=m.id
 AND emc.annee_scolaire_id=i.annee_scolaire_id
WHERE e.matricule='EL-CM2-2'
LIMIT 1;

-- ============================================================
-- BULLETINS / DEVOIRS / ABSENCES
-- ============================================================
INSERT INTO bulletin (eleve_id,classe_id,annee_scolaire_id,bimestre_id,moyenne_generale,rang,effectif_classe,decision)
SELECT e.id,i.classe_id,2,1,15.50,1,2,'Admis' FROM eleve e JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=2 WHERE e.matricule='EL-CM2-1';
INSERT INTO bulletin (eleve_id,classe_id,annee_scolaire_id,bimestre_id,moyenne_generale,rang,effectif_classe,decision)
SELECT e.id,i.classe_id,2,1,13.00,2,2,'Admis' FROM eleve e JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=2 WHERE e.matricule='EL-CM2-2';

INSERT INTO bulletin_matiere (bulletin_id,matiere_id,moyenne,coefficient,total_points)
SELECT b.id,m.id,15.50,m.coefficient,15.50*m.coefficient FROM bulletin b JOIN matiere m ON m.nom='Mathématiques' JOIN eleve e ON e.id=b.eleve_id WHERE e.matricule='EL-CM2-1';
INSERT INTO bulletin_matiere (bulletin_id,matiere_id,moyenne,coefficient,total_points)
SELECT b.id,m.id,13.00,m.coefficient,13.00*m.coefficient FROM bulletin b JOIN matiere m ON m.nom='Français' JOIN eleve e ON e.id=b.eleve_id WHERE e.matricule='EL-CM2-2';

INSERT INTO devoir (classe_id,matiere_id,enseignant_id,annee_scolaire_id,titre,consignes,date_assignation,date_limite,envoye)
SELECT c.id,m.id,u.id,2,'Devoir de mathématiques','Exercices chapitre 1',DATE '2025-09-08',DATE '2025-09-12',TRUE FROM classe c JOIN matiere m ON m.code='PRIMGEN' JOIN utilisateur u ON u.email='jean.rakoto@ecole.mg' WHERE c.nom='CM2';
INSERT INTO devoir (classe_id,matiere_id,enseignant_id,annee_scolaire_id,titre,consignes,date_assignation,date_limite,envoye)
SELECT c.id,m.id,u.id,2,'Devoir de français','Lecture et rédaction',DATE '2025-09-09',DATE '2025-09-15',TRUE FROM classe c JOIN matiere m ON m.code='PRIMGEN' JOIN utilisateur u ON u.email='jean.rakoto@ecole.mg' WHERE c.nom='CM2';

INSERT INTO absence_enseignant (enseignant_id,emploi_du_temps_id,date_absence,motif,justifiee)
SELECT e.enseignant_id,e.id,DATE '2025-09-10','Rendez-vous familial',TRUE FROM emploi_du_temps e ORDER BY e.id LIMIT 1;
INSERT INTO absence_enseignant (enseignant_id,emploi_du_temps_id,date_absence,motif,justifiee)
SELECT e.enseignant_id,e.id,DATE '2025-09-11','Absence personnelle',FALSE FROM emploi_du_temps e ORDER BY e.id OFFSET 1 LIMIT 1;
INSERT INTO absence_eleve (eleve_id,emploi_du_temps_id,date_absence,motif,justifiee)
SELECT e.id,edt.id,DATE '2025-09-10','Absence familiale',TRUE FROM eleve e JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=2 JOIN emploi_du_temps edt ON edt.classe_id=i.classe_id WHERE e.matricule='EL-CM2-1' ORDER BY edt.id LIMIT 1;
INSERT INTO absence_eleve (eleve_id,emploi_du_temps_id,date_absence,motif,justifiee)
SELECT e.id,edt.id,DATE '2025-09-11','Absence non justifiée',FALSE FROM eleve e JOIN inscription i ON i.eleve_id=e.id AND i.annee_scolaire_id=2 JOIN emploi_du_temps edt ON edt.classe_id=i.classe_id WHERE e.matricule='EL-CM2-2' ORDER BY edt.id LIMIT 1;

-- ============================================================
-- FINANCE / DOCUMENTS / NOTIFICATIONS / RAPPORTS
-- ============================================================
INSERT INTO salaire_enseignant (enseignant_id,type_salaire,montant,date_debut,actif)
SELECT id,'mensuel',650000,DATE '2025-09-01',TRUE FROM utilisateur WHERE email='jean.rakoto@ecole.mg';
INSERT INTO salaire_enseignant (enseignant_id,type_salaire,montant,date_debut,actif)
SELECT id,'mensuel',700000,DATE '2025-09-01',TRUE FROM utilisateur WHERE email='paul.randria@ecole.mg';
INSERT INTO paie (enseignant_id,salaire_id,mois,annee,salaire_base,salaire_brut,salaire_net,statut)
SELECT s.enseignant_id,s.id,9,2025,s.montant,s.montant,s.montant,'paye' FROM salaire_enseignant s JOIN utilisateur u ON u.id=s.enseignant_id WHERE u.email='jean.rakoto@ecole.mg';
INSERT INTO paie (enseignant_id,salaire_id,mois,annee,salaire_base,salaire_brut,salaire_net,statut)
SELECT s.enseignant_id,s.id,10,2025,s.montant,s.montant,s.montant,'prepare' FROM salaire_enseignant s JOIN utilisateur u ON u.id=s.enseignant_id WHERE u.email='paul.randria@ecole.mg';

-- Grille tarifaire (tarif_frais) : valeurs réelles de la fiche "Frais de scolarité
-- 2026-2027" du Lycée COPEC Mangabe, appliquées ici à l'année scolaire active (2025-2026)
-- en tant que démo — à reconduire (ou ajuster) sur la fiche via l'écran Tarifs dès que
-- l'année 2026-2027 sera créée. niveau_id : voir INSERT INTO niveau ci-dessus
-- (7=6eme,8=5eme,9=4eme,10=3eme A,11=3eme B,12=2nde,13=1ere L,14=1ere S,15=Term D,16=Term A2).
INSERT INTO tarif_frais (niveau_id,annee_scolaire_id,type_frais,libelle,montant,recurrent_mensuel) VALUES
-- Droit (annuel, identique à tous les niveaux)
(7,2,'droit','Droit de scolarité',70000,FALSE),(8,2,'droit','Droit de scolarité',70000,FALSE),
(9,2,'droit','Droit de scolarité',70000,FALSE),(10,2,'droit','Droit de scolarité',70000,FALSE),
(11,2,'droit','Droit de scolarité',70000,FALSE),(12,2,'droit','Droit de scolarité',70000,FALSE),
(13,2,'droit','Droit de scolarité',70000,FALSE),(14,2,'droit','Droit de scolarité',70000,FALSE),
(15,2,'droit','Droit de scolarité',70000,FALSE),(16,2,'droit','Droit de scolarité',70000,FALSE),
-- Écolage (mensuel, croissant par niveau)
(7,2,'ecolage','Écolage mensuel',25000,TRUE),(8,2,'ecolage','Écolage mensuel',26000,TRUE),
(9,2,'ecolage','Écolage mensuel',27000,TRUE),(10,2,'ecolage','Écolage mensuel',28000,TRUE),
(11,2,'ecolage','Écolage mensuel',28000,TRUE),(12,2,'ecolage','Écolage mensuel',29000,TRUE),
(13,2,'ecolage','Écolage mensuel',30000,TRUE),(14,2,'ecolage','Écolage mensuel',30000,TRUE),
(15,2,'ecolage','Écolage mensuel',33000,TRUE),(16,2,'ecolage','Écolage mensuel',33000,TRUE),
-- Feuille de copie examen (annuel, uniquement classes d'examen national : 3ème/BEPC, Terminale/Bacc)
(10,2,'frais_examen_national','Feuille de copie examen (BEPC)',20000,FALSE),
(11,2,'frais_examen_national','Feuille de copie examen (BEPC)',20000,FALSE),
(15,2,'frais_examen_national','Feuille de copie examen (Bacc)',20000,FALSE),
(16,2,'frais_examen_national','Feuille de copie examen (Bacc)',20000,FALSE);

INSERT INTO frais_scolaire (eleve_id,annee_scolaire_id,type_frais,libelle,montant_total,date_echeance,statut,mois)
SELECT e.id,2,'ecolage','Écolage septembre',150000,DATE '2025-09-15','impaye',9 FROM eleve e WHERE e.matricule='EL-CM2-1';
INSERT INTO frais_scolaire (eleve_id,annee_scolaire_id,type_frais,libelle,montant_total,date_echeance,statut,mois)
SELECT e.id,2,'ecolage','Écolage octobre',150000,DATE '2025-10-15','partiel',10 FROM eleve e WHERE e.matricule='EL-CM2-2';
INSERT INTO paiement (frais_id,eleve_id,montant,mode_paiement,recu_numero,utilisateur_id,agent_id)
SELECT f.id,f.eleve_id,100000,'especes','REC-0001',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg'),(SELECT id FROM agent WHERE email='secretaire@ecole.mg') FROM frais_scolaire f JOIN eleve e ON e.id=f.eleve_id WHERE e.matricule='EL-CM2-1';
INSERT INTO paiement (frais_id,eleve_id,montant,mode_paiement,recu_numero,utilisateur_id,agent_id)
SELECT f.id,f.eleve_id,75000,'mobile_money','REC-0002',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg'),(SELECT id FROM agent WHERE email='secretaire@ecole.mg') FROM frais_scolaire f JOIN eleve e ON e.id=f.eleve_id WHERE e.matricule='EL-CM2-2';

INSERT INTO document_eleve (eleve_id,type_document,nom_fichier,fichier_url,description,date_document) SELECT id,'certificat','certificat_1.pdf','/uploads/certificat_1.pdf','Certificat de naissance',DATE '2025-09-01' FROM eleve WHERE matricule='EL-CM2-1';
INSERT INTO document_eleve (eleve_id,type_document,nom_fichier,fichier_url,description,date_document) SELECT id,'photo','photo_2.jpg','/uploads/photo_2.jpg','Photo élève',DATE '2025-09-01' FROM eleve WHERE matricule='EL-CM2-2';
INSERT INTO notification (eleve_id,auteur_admin_id,titre,message,type_notification,lu) SELECT e.id,u.id,'Bienvenue','Bienvenue dans la nouvelle année scolaire.','info',FALSE FROM eleve e JOIN utilisateur u ON u.email='admin@ecole.mg' WHERE e.matricule='EL-CM2-1';
INSERT INTO notification (eleve_id,auteur_admin_id,titre,message,type_notification,lu) SELECT e.id,u.id,'Paiement','Votre paiement a été enregistré.','finance',TRUE FROM eleve e JOIN utilisateur u ON u.email='admin@ecole.mg' WHERE e.matricule='EL-CM2-2';
INSERT INTO envoi_rapport (auteur_id,scope_type,scope_valeur,contenu,canal,bimestre_id,nb_destinataires) SELECT id,'classe','CM2','Bulletin du bimestre 1','email',1,2 FROM utilisateur WHERE email='admin@ecole.mg';
INSERT INTO envoi_rapport (auteur_id,scope_type,scope_valeur,contenu,canal,bimestre_id,nb_destinataires) SELECT id,'classe','CM2','Rappel de paiement','les_deux',1,2 FROM utilisateur WHERE email='admin@ecole.mg';
INSERT INTO envoi_rapport_detail (envoi_rapport_id,eleve_id,email_statut,whatsapp_statut) SELECT er.id,e.id,'envoye','non_applicable' FROM envoi_rapport er JOIN eleve e ON e.matricule='EL-CM2-1' WHERE er.contenu='Bulletin du bimestre 1';
INSERT INTO envoi_rapport_detail (envoi_rapport_id,eleve_id,email_statut,whatsapp_statut) SELECT er.id,e.id,'envoye','envoye' FROM envoi_rapport er JOIN eleve e ON e.matricule='EL-CM2-2' WHERE er.contenu='Rappel de paiement';
INSERT INTO actualite (titre,contenu,auteur_id,publie,date_publication) SELECT 'Rentrée scolaire','Bienvenue pour la rentrée 2025-2026.',id,TRUE,NOW() FROM utilisateur WHERE email='admin@ecole.mg';
INSERT INTO actualite (titre,contenu,auteur_id,publie,date_publication) SELECT 'Réunion parents','Réunion parents-professeurs prévue prochainement.',id,TRUE,NOW() FROM utilisateur WHERE email='admin@ecole.mg';

-- ============================================================
-- EXAMENS / DISCIPLINE / TRANSFERTS / CAISSE / MESSAGERIE / AUDIT
-- 2 lignes minimum pour chaque table nouvelle
-- ============================================================
INSERT INTO examen (annee_scolaire_id,classe_id,nom,type_examen,bimestre_id,date_debut,date_fin,statut)
SELECT 2,id,'Contrôle continu 1','controle',1,DATE '2025-10-10',DATE '2025-10-10','termine' FROM classe WHERE nom='CM2';
INSERT INTO examen (annee_scolaire_id,classe_id,nom,type_examen,bimestre_id,date_debut,date_fin,statut)
SELECT 2,id,'Composition 1','composition',1,DATE '2025-11-20',DATE '2025-11-21','planifie' FROM classe WHERE nom='6eme';

INSERT INTO examen_matiere (examen_id,matiere_id,enseignant_id,date_examen,heure_debut,heure_fin,coefficient,classe_id,annee_scolaire_id)
SELECT ex.id,m.id,u.id,DATE '2025-10-10',TIME '08:00',TIME '09:00',m.coefficient,ex.classe_id,ex.annee_scolaire_id
FROM examen ex JOIN matiere m ON m.code='PRIMGEN' JOIN utilisateur u ON u.email='jean.rakoto@ecole.mg' WHERE ex.nom='Contrôle continu 1';
INSERT INTO examen_matiere (examen_id,matiere_id,enseignant_id,date_examen,heure_debut,heure_fin,coefficient,classe_id,annee_scolaire_id)
SELECT ex.id,m.id,u.id,DATE '2025-11-20',TIME '08:00',TIME '09:00',m.coefficient,ex.classe_id,ex.annee_scolaire_id
FROM examen ex JOIN matiere m ON m.nom='Mathématiques' JOIN utilisateur u ON u.email='paul.randria@ecole.mg' WHERE ex.nom='Composition 1';

INSERT INTO resultat_examen (examen_matiere_id,eleve_id,note,absence,observation)
SELECT em.id,e.id,16,FALSE,'Bon résultat' FROM examen_matiere em JOIN examen ex ON ex.id=em.examen_id JOIN eleve e ON e.matricule='EL-CM2-1' WHERE ex.nom='Contrôle continu 1';
INSERT INTO resultat_examen (examen_matiere_id,eleve_id,note,absence,observation)
SELECT em.id,e.id,NULL,TRUE,'Absent' FROM examen_matiere em JOIN examen ex ON ex.id=em.examen_id JOIN eleve e ON e.matricule='EL-6eme-1' WHERE ex.nom='Composition 1';

INSERT INTO discipline (eleve_id,date_incident,type_incident,description,gravite,auteur_utilisateur_id,parent_informe)
SELECT id,DATE '2025-09-12','retard_repete','Retards répétés','faible',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg'),TRUE FROM eleve WHERE matricule='EL-CM2-1';
INSERT INTO discipline (eleve_id,date_incident,type_incident,description,gravite,auteur_utilisateur_id,parent_informe)
SELECT id,DATE '2025-09-13','comportement','Comportement en classe','moyenne',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg'),FALSE FROM eleve WHERE matricule='EL-CM2-2';

-- nouvelle_classe_id = NULL : la nouvelle classe est dans une AUTRE école (nouvelle_ecole
-- renseignée), donc elle n'existe pas dans notre table classe. Pointer nouvelle_classe_id
-- vers c.id (la même ligne que ancienne_classe_id) était incohérent : ça donnait l'impression
-- que l'élève restait dans la même classe de la même école tout en la quittant.
INSERT INTO transfert_eleve (eleve_id,ancienne_classe_id,nouvelle_classe_id,ancienne_ecole,nouvelle_ecole,date_transfert,motif,auteur_id)
SELECT e.id,c.id,NULL,'École A','École B',DATE '2025-09-15','Changement d''école',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg') FROM eleve e JOIN inscription i ON i.eleve_id=e.id JOIN classe c ON c.id=i.classe_id WHERE e.matricule='EL-CM2-1';
INSERT INTO transfert_eleve (eleve_id,ancienne_classe_id,nouvelle_classe_id,ancienne_ecole,nouvelle_ecole,date_transfert,motif,auteur_id)
SELECT e.id,c.id,NULL,'École C','École D',DATE '2025-09-16','Rapprochement familial',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg') FROM eleve e JOIN inscription i ON i.eleve_id=e.id JOIN classe c ON c.id=i.classe_id WHERE e.matricule='EL-CM2-2';

INSERT INTO sortie_eleve (eleve_id,annee_scolaire_id,date_sortie,motif,destination,observation,auteur_id)
SELECT id,2,DATE '2026-06-15','fin_cycle','Établissement supérieur','Fin de cycle',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg') FROM eleve WHERE matricule='EL-CM2-1';
INSERT INTO sortie_eleve (eleve_id,annee_scolaire_id,date_sortie,motif,destination,observation,auteur_id)
SELECT id,1,DATE '2025-06-20','transfert','Autre école','Transfert',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg') FROM eleve WHERE matricule='EL-CM2-2';

INSERT INTO categorie_depense (nom) VALUES ('Fournitures'),('Entretien');
INSERT INTO depense (categorie_id,libelle,montant,date_depense,mode_paiement,utilisateur_id,observation) VALUES
((SELECT id FROM categorie_depense WHERE nom='Fournitures'),'Achat cahiers',50000,DATE '2025-09-05','especes',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg'),'Fournitures scolaires'),
((SELECT id FROM categorie_depense WHERE nom='Entretien'),'Réparation salle',80000,DATE '2025-09-06','virement',(SELECT id FROM utilisateur WHERE email='admin@ecole.mg'),'Maintenance');
INSERT INTO caisse (nom,solde_initial) VALUES ('Caisse principale',500000),('Caisse secondaire',200000);
INSERT INTO mouvement_caisse (caisse_id,type_mouvement,montant,reference,depense_id,utilisateur_id)
SELECT c.id,'sortie',50000,'DEP-001',d.id,(SELECT id FROM utilisateur WHERE email='admin@ecole.mg') FROM caisse c JOIN depense d ON d.libelle='Achat cahiers' WHERE c.nom='Caisse principale';
INSERT INTO mouvement_caisse (caisse_id,type_mouvement,montant,reference,depense_id,utilisateur_id)
SELECT c.id,'sortie',80000,'DEP-002',d.id,(SELECT id FROM utilisateur WHERE email='admin@ecole.mg') FROM caisse c JOIN depense d ON d.libelle='Réparation salle' WHERE c.nom='Caisse secondaire';

-- Même correctif que pour eleve_parent : on retrouve le parent via l'email généré,
-- pas via une coïncidence d'id entre les tables parent et eleve.
INSERT INTO message_parent (parent_id,eleve_id,auteur_utilisateur_id,sujet,message,canal,statut)
SELECT p.id,e.id,(SELECT id FROM utilisateur WHERE email='admin@ecole.mg'),'Bienvenue','Bienvenue dans notre école.','interne','envoye' FROM eleve e JOIN parent p ON p.email='parent_'||e.id||'@ecole.mg' WHERE e.matricule='EL-CM2-1';
INSERT INTO message_parent (parent_id,eleve_id,auteur_agent_id,sujet,message,canal,statut)
SELECT p.id,e.id,(SELECT id FROM agent WHERE email='secretaire@ecole.mg'),'Paiement','Votre paiement est enregistré.','email','lu' FROM eleve e JOIN parent p ON p.email='parent_'||e.id||'@ecole.mg' WHERE e.matricule='EL-CM2-2';
INSERT INTO audit_log (utilisateur_id,action,table_nom,record_id,nouvelle_valeur)
SELECT id,'creation','eleve',(SELECT id FROM eleve WHERE matricule='EL-CM2-1'),jsonb_build_object('matricule','EL-CM2-1') FROM utilisateur WHERE email='admin@ecole.mg';
INSERT INTO audit_log (utilisateur_id,action,table_nom,record_id,nouvelle_valeur)
SELECT id,'modification','paiement',(SELECT id FROM paiement WHERE recu_numero='REC-0001'),jsonb_build_object('recu','REC-0001') FROM utilisateur WHERE email='admin@ecole.mg';

-- ============================================================
-- SYNCHRONISATION DES SÉQUENCES
-- ============================================================
SELECT setval(pg_get_serial_sequence('cycle','id'),COALESCE(MAX(id),1),TRUE) FROM cycle;
SELECT setval(pg_get_serial_sequence('niveau','id'),COALESCE(MAX(id),1),TRUE) FROM niveau;
SELECT setval(pg_get_serial_sequence('bimestre','id'),COALESCE(MAX(id),1),TRUE) FROM bimestre;

-- ============================================================
-- VÉRIFICATIONS FINALES
-- ============================================================
SELECT 'utilisateur' table_nom,COUNT(*) total FROM utilisateur
UNION ALL SELECT 'agent',COUNT(*) FROM agent
UNION ALL SELECT 'annee_scolaire',COUNT(*) FROM annee_scolaire
UNION ALL SELECT 'cycle',COUNT(*) FROM cycle
UNION ALL SELECT 'niveau',COUNT(*) FROM niveau
UNION ALL SELECT 'bimestre',COUNT(*) FROM bimestre
UNION ALL SELECT 'classe',COUNT(*) FROM classe
UNION ALL SELECT 'tarif_frais',COUNT(*) FROM tarif_frais
UNION ALL SELECT 'matiere',COUNT(*) FROM matiere
UNION ALL SELECT 'classe_matiere',COUNT(*) FROM classe_matiere
UNION ALL SELECT 'enseignant_matiere',COUNT(*) FROM enseignant_matiere
UNION ALL SELECT 'enseignant_matiere_classe',COUNT(*) FROM enseignant_matiere_classe
UNION ALL SELECT 'eleve',COUNT(*) FROM eleve
UNION ALL SELECT 'inscription',COUNT(*) FROM inscription
UNION ALL SELECT 'emploi_du_temps',COUNT(*) FROM emploi_du_temps
UNION ALL SELECT 'pointage_enseignant',COUNT(*) FROM pointage_enseignant
UNION ALL SELECT 'pointage_eleve',COUNT(*) FROM pointage_eleve
UNION ALL SELECT 'note',COUNT(*) FROM note
UNION ALL SELECT 'bulletin',COUNT(*) FROM bulletin
UNION ALL SELECT 'bulletin_matiere',COUNT(*) FROM bulletin_matiere
UNION ALL SELECT 'devoir',COUNT(*) FROM devoir
UNION ALL SELECT 'absence_enseignant',COUNT(*) FROM absence_enseignant
UNION ALL SELECT 'absence_eleve',COUNT(*) FROM absence_eleve
UNION ALL SELECT 'salaire_enseignant',COUNT(*) FROM salaire_enseignant
UNION ALL SELECT 'paie',COUNT(*) FROM paie
UNION ALL SELECT 'frais_scolaire',COUNT(*) FROM frais_scolaire
UNION ALL SELECT 'paiement',COUNT(*) FROM paiement
UNION ALL SELECT 'document_eleve',COUNT(*) FROM document_eleve
UNION ALL SELECT 'notification',COUNT(*) FROM notification
UNION ALL SELECT 'envoi_rapport',COUNT(*) FROM envoi_rapport
UNION ALL SELECT 'envoi_rapport_detail',COUNT(*) FROM envoi_rapport_detail
UNION ALL SELECT 'actualite',COUNT(*) FROM actualite
UNION ALL SELECT 'parent',COUNT(*) FROM parent
UNION ALL SELECT 'eleve_parent',COUNT(*) FROM eleve_parent
UNION ALL SELECT 'examen',COUNT(*) FROM examen
UNION ALL SELECT 'examen_matiere',COUNT(*) FROM examen_matiere
UNION ALL SELECT 'resultat_examen',COUNT(*) FROM resultat_examen
UNION ALL SELECT 'discipline',COUNT(*) FROM discipline
UNION ALL SELECT 'transfert_eleve',COUNT(*) FROM transfert_eleve
UNION ALL SELECT 'sortie_eleve',COUNT(*) FROM sortie_eleve
UNION ALL SELECT 'categorie_depense',COUNT(*) FROM categorie_depense
UNION ALL SELECT 'depense',COUNT(*) FROM depense
UNION ALL SELECT 'caisse',COUNT(*) FROM caisse
UNION ALL SELECT 'mouvement_caisse',COUNT(*) FROM mouvement_caisse
UNION ALL SELECT 'message_parent',COUNT(*) FROM message_parent
UNION ALL SELECT 'audit_log',COUNT(*) FROM audit_log
ORDER BY table_nom;

-- Comptes de démo/dev : pas de blocage par l'écran "Confirmer mon compte" (selfie).
-- En production réelle, un compte enseignant fraîchement créé aura compte_confirme = FALSE
-- et devra faire son selfie de référence à la première connexion.
UPDATE utilisateur SET compte_confirme = TRUE;

-- ============================================================
-- Activation de la synchronisation offline/online (fusionné depuis
-- database/sync/sync-schema.sql) : installée APRÈS le chargement des données
-- de démo ci-dessus, pour que les lignes du seed ne soient pas elles-mêmes
-- journalisées dans sync_change au premier démarrage.
-- ============================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT c.oid, c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname NOT IN ('sync_change','sync_device','sync_conflict','sync_state')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_copec_sync ON public.%I', r.relname);
        EXECUTE format('CREATE TRIGGER trg_copec_sync AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION copec_sync_capture()', r.relname);
    END LOOP;
END $$;

ANALYZE;

COMMIT;
