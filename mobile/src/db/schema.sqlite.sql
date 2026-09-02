-- Schema SQLite ho an'ny appli mobile "Espace Enseignant".
-- Sombiny amin'ny database/schema.sql (PostgreSQL, 66 tabilao) ihany no nalaina eto —
-- ny tabilao ilain'ny mpampianatra ihany (jereo backend/src/config/mobileSyncTables.js,
-- fototra iray ihany ho an'ny roa tonta mba tsy hisy tsy fitoviana).
--
-- Fanamarihana amin'ny fiovana Postgres -> SQLite:
--   * SERIAL/IDENTITY  -> INTEGER PRIMARY KEY (id central lasa tsotra: an'ity tabilao ity
--     ihany no anjaran'ny id an'ilay id nomen'ny Neon, tsy jenerémina eto).
--   * TIMESTAMPTZ      -> TEXT (ISO 8601, ohatra '2026-09-01T08:00:00.000Z')
--   * BOOLEAN          -> INTEGER (0/1)
--   * JSONB            -> TEXT (JSON.stringify)
--   * DECIMAL          -> REAL
--   * Tsy misy FOREIGN KEY CONSTRAINT henjana eto: ny fanamarinana (validation) atao
--     ao amin'ny backend ihany rehefa push (applyChange), tsy eto an-toerana, satria
--     ny SQLite lokaly dia mety mbola tsy manana ny tabilao rehetra voatanisa (ohatra:
--     mpianatra vao noforonin'ny secrétaire, mbola tsy tafiditra amin'ny pull farany).

CREATE TABLE IF NOT EXISTS annee_scolaire (
  id INTEGER PRIMARY KEY,
  libelle TEXT NOT NULL,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bimestre (
  id INTEGER PRIMARY KEY,
  annee_scolaire_id INTEGER NOT NULL,
  numero INTEGER NOT NULL,
  libelle TEXT NOT NULL,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS matiere (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  code TEXT,
  coefficient INTEGER NOT NULL DEFAULT 1,
  actif INTEGER NOT NULL DEFAULT 1,
  couleur TEXT
);

CREATE TABLE IF NOT EXISTS classe (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  niveau_id INTEGER NOT NULL,
  filiere TEXT,
  salle TEXT,
  titulaire_id INTEGER,
  annee_scolaire_id INTEGER NOT NULL,
  capacite INTEGER
);

CREATE TABLE IF NOT EXISTS classe_matiere (
  id INTEGER PRIMARY KEY,
  classe_id INTEGER NOT NULL,
  matiere_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS enseignant_matiere (
  id INTEGER PRIMARY KEY,
  enseignant_id INTEGER NOT NULL,
  matiere_id INTEGER NOT NULL,
  annee_scolaire_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS enseignant_matiere_classe (
  id INTEGER PRIMARY KEY,
  enseignant_id INTEGER NOT NULL,
  matiere_id INTEGER NOT NULL,
  classe_id INTEGER NOT NULL,
  annee_scolaire_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS eleve (
  id INTEGER PRIMARY KEY,
  matricule TEXT NOT NULL,
  nom TEXT NOT NULL,
  prenom TEXT,
  photo_url TEXT,
  actif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS inscription (
  id INTEGER PRIMARY KEY,
  eleve_id INTEGER NOT NULL,
  classe_id INTEGER NOT NULL,
  annee_scolaire_id INTEGER NOT NULL,
  statut TEXT NOT NULL DEFAULT 'inscrit'
);

CREATE TABLE IF NOT EXISTS emploi_du_temps (
  id INTEGER PRIMARY KEY,
  classe_id INTEGER NOT NULL,
  matiere_id INTEGER NOT NULL,
  enseignant_id INTEGER NOT NULL,
  annee_scolaire_id INTEGER NOT NULL,
  jour TEXT NOT NULL,
  heure_debut TEXT NOT NULL,
  heure_fin TEXT NOT NULL,
  salle TEXT,
  actif INTEGER NOT NULL DEFAULT 1
);

-- Ecriture mobile : "appel" (pointage) fanaovan'ny mpampianatra
CREATE TABLE IF NOT EXISTS pointage_enseignant (
  id INTEGER PRIMARY KEY,
  enseignant_id INTEGER NOT NULL,
  emploi_du_temps_id INTEGER NOT NULL,
  date_pointage TEXT NOT NULL,
  heure_arrivee TEXT,
  heure_depart TEXT,
  statut TEXT NOT NULL,
  commentaire TEXT,
  uuid_local TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'manuel',
  _pending_sync INTEGER NOT NULL DEFAULT 0
);

-- Ecriture mobile : "appel" ny fisian'ny mpianatra tsirairay
CREATE TABLE IF NOT EXISTS pointage_eleve (
  id INTEGER PRIMARY KEY,
  eleve_id INTEGER NOT NULL,
  classe_id INTEGER NOT NULL,
  annee_scolaire_id INTEGER NOT NULL,
  enseignant_id INTEGER NOT NULL,
  emploi_du_temps_id INTEGER NOT NULL,
  date_pointage TEXT NOT NULL,
  statut TEXT NOT NULL,
  commentaire TEXT,
  _pending_sync INTEGER NOT NULL DEFAULT 0
);

-- Ecriture mobile : naoty
CREATE TABLE IF NOT EXISTS note (
  id INTEGER PRIMARY KEY,
  eleve_id INTEGER NOT NULL,
  classe_id INTEGER NOT NULL,
  matiere_id INTEGER NOT NULL,
  enseignant_id INTEGER NOT NULL,
  annee_scolaire_id INTEGER NOT NULL,
  bimestre_id INTEGER NOT NULL,
  note_valeur REAL NOT NULL,
  type_evaluation TEXT,
  coefficient_evaluation REAL NOT NULL DEFAULT 1,
  commentaire TEXT,
  _pending_sync INTEGER NOT NULL DEFAULT 0
);

-- Ecriture mobile : adidy/asa fandinihana
CREATE TABLE IF NOT EXISTS devoir (
  id INTEGER PRIMARY KEY,
  classe_id INTEGER NOT NULL,
  matiere_id INTEGER NOT NULL,
  enseignant_id INTEGER NOT NULL,
  annee_scolaire_id INTEGER NOT NULL,
  titre TEXT NOT NULL,
  consignes TEXT,
  date_assignation TEXT NOT NULL,
  date_limite TEXT,
  _pending_sync INTEGER NOT NULL DEFAULT 0
);

-- Ecriture mobile : fanambarana tsy fahatongavan'ny mpampianatra
CREATE TABLE IF NOT EXISTS absence_enseignant (
  id INTEGER PRIMARY KEY,
  enseignant_id INTEGER NOT NULL,
  emploi_du_temps_id INTEGER,
  date_absence TEXT NOT NULL,
  motif TEXT,
  justifiee INTEGER NOT NULL DEFAULT 0,
  _pending_sync INTEGER NOT NULL DEFAULT 0
);

-- Vakiana fotsiny (paie/mon-salaire), tsy ovaina mobile
CREATE TABLE IF NOT EXISTS salaire_enseignant (
  id INTEGER PRIMARY KEY,
  enseignant_id INTEGER NOT NULL,
  type_salaire TEXT NOT NULL,
  montant REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS utilisateur (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  prenom TEXT,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  photo_url TEXT
);

-- ===========================================================================
-- Tabilao ho an'ny SYNC lokaly (tsy misy mitovy azy amin'ny Neon central).
-- ===========================================================================

-- Filaharana ny fanovana natao teto an-toerana, mbola tsy voaray/ekena
-- an'ilay backend Internet (tahiry hatramin'izay misy connection).
CREATE TABLE IF NOT EXISTS sync_change_local (
  local_id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id TEXT NOT NULL UNIQUE,   -- UUID jenerémina eto an-toerana (idempotence)
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL,             -- INSERT | UPDATE | DELETE
  row_key TEXT NOT NULL,               -- JSON
  old_row TEXT,                        -- JSON
  new_row TEXT,                        -- JSON
  changed_at TEXT NOT NULL,
  pushed INTEGER NOT NULL DEFAULT 0
);

-- Cursor tokana ho an'ny pull (mitovitovy amin'ny sync_state central)
CREATE TABLE IF NOT EXISTS sync_state_local (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  last_pulled_change_id INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'idle'  -- idle | syncing | offline | error
);
INSERT OR IGNORE INTO sync_state_local (singleton) VALUES (1);
