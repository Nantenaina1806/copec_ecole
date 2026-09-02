import { useState, useMemo } from 'react';
import { CalendarCheck, UserCheck, UserX, CalendarX, FileText, Wallet, AlertTriangle, RefreshCw, FileDown, User, Tag } from 'lucide-react';
import client from '../../api/client';
import { useFetch } from '../../hooks/useFetch';
import { useAuth } from '../../context/AuthContext';
import { useEcole } from '../../context/EcoleContext';
import DataTable from '../../components/DataTable';
import StatCard from '../../components/StatCard';
import { SectionHeader, Badge } from '../../components/Shared';
import { printTable } from '../../utils/exportUtils';

const TYPE_TONE = {
  presence: 'green', presence_enseignant: 'green',
  absence_eleve: 'violet', absence_enseignant: 'violet',
  note: 'brand', finance: 'amber', discipline: 'red',
};
const TYPE_LABEL = {
  presence: 'Appel (présence)', presence_enseignant: 'Présence enseignant',
  absence_eleve: 'Absence élève', absence_enseignant: 'Absence enseignant',
  note: 'Note', finance: 'Finance', discipline: 'Discipline',
};
const TYPE_ICON = {
  presence: CalendarCheck, presence_enseignant: UserCheck,
  absence_eleve: UserX, absence_enseignant: CalendarX,
  note: FileText, finance: Wallet, discipline: AlertTriangle,
};

const TOUS_TYPES = ['presence', 'presence_enseignant', 'absence_eleve', 'absence_enseignant', 'note', 'finance', 'discipline'];
// Un agent (secretaire/economie/surveillant) n'authentifie jamais présences/notes ; on limite
// les filtres proposés à ce qui est pertinent pour son rôle.
const TYPES_PAR_ROLE = {
  // Le secrétariat gère de bout en bout les déclarations d'absences (élèves et enseignants,
  // cf. Présences) sans passer par l'admin : ces deux types lui sont désormais utiles, en plus
  // des finances/discipline déjà présents. Il ne fait jamais l'appel lui-même (ça, c'est
  // "presence"/"presence_enseignant", réservé au surveillant/enseignant).
  secretaire: ['absence_eleve', 'absence_enseignant', 'finance', 'discipline'],
  economie: ['finance', 'discipline'],
  // Le surveillant ne peut jamais encaisser de paiement (ROLES_FINANCE = admin + economie
  // côté backend) : le filtre "Finance" renvoyait donc toujours une liste vide pour lui.
  // En revanche il fait l'appel des élèves (POST /pointage/appel) et gère de bout en bout les
  // absences (élèves et enseignants) : ces types lui sont désormais utiles.
  surveillant: ['presence', 'presence_enseignant', 'absence_eleve', 'absence_enseignant', 'discipline'],
};
// Le filtre « Classe » n'a de sens que pour les types rattachés à une classe (appel, notes) —
// pour finance/discipline (le seul cas de l'économie) il n'a aucun effet côté API : on ne
// l'affiche donc que si au moins un type actif le prend en charge, pour ne pas montrer un
// filtre qui ne filtre rien.
const TYPES_AVEC_FILTRE_CLASSE = new Set(['presence', 'note']);

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Raccourcis de période — évite de manipuler les deux champs de date à la main pour les cas
// les plus courants (regarder ce qui s'est passé cette semaine / ce mois-ci).
function plagesRapides() {
  const auj = new Date();
  const jourSemaine = auj.getDay(); // 0 = dimanche
  const lundi = new Date(auj);
  lundi.setDate(auj.getDate() - (jourSemaine === 0 ? 6 : jourSemaine - 1));
  const dimanche = new Date(lundi);
  dimanche.setDate(lundi.getDate() + 6);
  const premierJourMois = new Date(auj.getFullYear(), auj.getMonth(), 1);
  const dernierJourMois = new Date(auj.getFullYear(), auj.getMonth() + 1, 0);
  return {
    aujourdhui: [isoDate(auj), isoDate(auj)],
    semaine: [isoDate(lundi), isoDate(dimanche)],
    mois: [isoDate(premierJourMois), isoDate(dernierJourMois)],
  };
}

const HISTORIQUE_EXPORT_COLUMNS = [
  { label: 'Date', value: (r) => new Date(r.date).toLocaleDateString('fr-FR') },
  { label: 'Type', value: (r) => TYPE_LABEL[r.type] || r.type },
  { label: 'Élève', value: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom || ''}`.trim() || '—' },
  { label: 'Événement', value: (r) => r.titre || '' },
  { label: 'Détail', value: (r) => r.detail || '' },
  { label: 'Auteur', value: (r) => r.auteur || '' },
];

export default function Historique() {
  const { user } = useAuth();
  const ecole = useEcole();
  const isAdmin = user?.role === 'admin';
  const typesDisponibles = isAdmin ? TOUS_TYPES : (TYPES_PAR_ROLE[user?.role] || TOUS_TYPES);
  const filtreClasseUtile = typesDisponibles.some((t) => TYPES_AVEC_FILTRE_CLASSE.has(t));

  const { data: classes } = useFetch(() => (filtreClasseUtile ? client.get('/classes').then((r) => r.data) : Promise.resolve([])), [filtreClasseUtile]);
  const [types, setTypes] = useState(new Set(typesDisponibles));
  const [classeId, setClasseId] = useState('');
  const [dateDebut, setDateDebut] = useState('');
  const [dateFin, setDateFin] = useState('');

  const [eleveSearch, setEleveSearch] = useState('');
  const [eleveId, setEleveId] = useState('');
  const { data: eleves } = useFetch(
    () => (eleveSearch ? client.get('/eleves', { params: { search: eleveSearch } }).then((r) => r.data) : Promise.resolve([])),
    [eleveSearch]
  );

  const [enseignantId, setEnseignantId] = useState('');
  const { data: utilisateurs } = useFetch(
    () => (isAdmin ? client.get('/utilisateurs').then((r) => r.data) : Promise.resolve([])),
    [isAdmin]
  );
  const enseignants = useMemo(() => (utilisateurs || []).filter((u) => u.role === 'enseignant' && u.actif), [utilisateurs]);

  const { data: reponse, loading, error, reload } = useFetch(
    () => client.get('/historique', {
      params: {
        type: [...types],
        classe_id: classeId || undefined,
        date_debut: dateDebut || undefined,
        date_fin: dateFin || undefined,
        eleve_id: eleveId || undefined,
        enseignant_id: isAdmin ? (enseignantId || undefined) : undefined,
      },
    }).then((r) => r.data),
    [[...types].join(','), classeId, dateDebut, dateFin, eleveId, enseignantId]
  );

  const [dernierRafraichi, setDernierRafraichi] = useState(new Date());
  const rafraichir = () => { reload(); setDernierRafraichi(new Date()); };

  // Rétro-compatible : l'API renvoie désormais { scope, rows } au lieu d'un simple tableau.
  const rows = useMemo(() => (Array.isArray(reponse) ? reponse : reponse?.rows) || [], [reponse]);
  const scope = Array.isArray(reponse) ? (isAdmin ? 'admin' : 'agent') : reponse?.scope;

  const compteParType = useMemo(() => {
    const c = { presence: 0, presence_enseignant: 0, absence_eleve: 0, absence_enseignant: 0, note: 0, finance: 0, discipline: 0 };
    rows.forEach((r) => { if (c[r.type] !== undefined) c[r.type] += 1; });
    return c;
  }, [rows]);

  const toggleType = (t) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const filtresActifs = classeId || dateDebut || dateFin || eleveId || enseignantId || types.size !== typesDisponibles.length;
  const resetFiltres = () => {
    setTypes(new Set(typesDisponibles));
    setClasseId(''); setDateDebut(''); setDateFin('');
    setEleveSearch(''); setEleveId(''); setEnseignantId('');
    setRaccourciActif(null);
  };

  const rapides = plagesRapides();
  const [raccourciActif, setRaccourciActif] = useState(null); // 'aujourdhui' | 'semaine' | 'mois' | null
  const appliquerRaccourci = (cle) => {
    const [debut, fin] = rapides[cle];
    setDateDebut(debut); setDateFin(fin);
    setRaccourciActif(cle);
  };
  // Un raccourci n'est plus "actif" visuellement dès que les dates sont modifiées manuellement
  // ou réinitialisées — évite un bouton qui reste sélectionné alors qu'il ne correspond plus
  // aux dates réellement affichées.
  const dateChange = (setter) => (e) => { setter(e.target.value); setRaccourciActif(null); };

  return (
    <div>
      <SectionHeader
        title="Historique"
        subtitle={
          scope === 'admin'
            ? 'Vue chronologique de toutes les activités (présences, absences, notes, finances, discipline)'
            : `Vos propres actions uniquement, ${user?.prenom || ''} ${user?.nom || ''}`.trim()
        }
        action={
          <button type="button" className="btn-ghost inline-flex items-center gap-2 text-xs" onClick={rafraichir}>
            <RefreshCw size={14} /> Rafraîchi à {dernierRafraichi.toLocaleTimeString('fr-FR')}
          </button>
        }
      />

      {scope && scope !== 'admin' && (
        <div className="card mb-4 !py-3 bg-brand-50 border border-brand-100 text-sm text-brand-800">
          Cette page affiche uniquement l&apos;historique de vos propres actions. Connecté(e) en tant que <strong>{user?.prenom} {user?.nom}</strong>.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
        {typesDisponibles.map((t) => {
          const Icon = TYPE_ICON[t];
          return <StatCard key={t} label={TYPE_LABEL[t]} value={compteParType[t]} icon={<Icon size={18} />} tone={t === 'discipline' && compteParType[t] > 0 ? 'red' : 'brand'} />;
        })}
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {typesDisponibles.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={types.has(t) ? 'btn-primary' : 'btn-secondary'}
            >
              {TYPE_LABEL[t]} ({compteParType[t]})
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <div className="max-w-xs flex-1 min-w-[180px]">
            <label className="label">Élève</label>
            <input
              className="input"
              placeholder="Rechercher un élève…"
              value={eleveSearch}
              onChange={(e) => { setEleveSearch(e.target.value); setEleveId(''); }}
            />
          </div>
          {eleveSearch && (
            <div className="max-w-xs flex-1 min-w-[180px]">
              <label className="label">&nbsp;</label>
              <select className="input" value={eleveId} onChange={(e) => setEleveId(e.target.value)}>
                <option value="">— Tous les résultats —</option>
                {eleves?.map((el) => <option key={el.id} value={el.id}>{el.nom} {el.prenom} {el.matricule ? `(${el.matricule})` : ''}</option>)}
              </select>
            </div>
          )}
          <div className="max-w-xs flex-1 min-w-[160px]" hidden={!filtreClasseUtile}>
            <label className="label">Classe</label>
            <select className="input" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
              <option value="">Toutes les classes</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </div>
          {isAdmin && (
            <div className="max-w-xs flex-1 min-w-[180px]">
              <label className="label">Enseignant</label>
              <select className="input" value={enseignantId} onChange={(e) => setEnseignantId(e.target.value)}>
                <option value="">Tous les enseignants</option>
                {enseignants.map((e) => <option key={e.id} value={e.id}>{e.nom} {e.prenom}</option>)}
              </select>
            </div>
          )}
          <div className="max-w-xs flex-1 min-w-[140px]">
            <label className="label">Du</label>
            <input type="date" className="input" value={dateDebut} onChange={dateChange(setDateDebut)} />
          </div>
          <div className="max-w-xs flex-1 min-w-[140px]">
            <label className="label">Au</label>
            <input type="date" className="input" value={dateFin} onChange={dateChange(setDateFin)} />
          </div>
          {filtresActifs && (
            <button type="button" className="btn-ghost text-sm" onClick={resetFiltres}>Réinitialiser</button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Période rapide</span>
          {[
            { cle: 'aujourdhui', label: "Aujourd'hui" },
            { cle: 'semaine', label: 'Cette semaine' },
            { cle: 'mois', label: 'Ce mois-ci' },
          ].map((r) => (
            <button
              key={r.cle}
              type="button"
              onClick={() => appliquerRaccourci(r.cle)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                raccourciActif === r.cle ? 'bg-brand-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-900">Chronologie</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={!rows.length} onClick={() => printTable({ title: 'Historique', subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')}`, columns: HISTORIQUE_EXPORT_COLUMNS, rows })}>
              🖨️ Imprimer
            </button>
            <button type="button" className="btn-secondary" disabled={!rows.length} onClick={() => import('../../utils/excelExport').then((m) => m.exportToExcel({ columns: HISTORIQUE_EXPORT_COLUMNS, rows, filename: 'historique', sheetName: 'Historique' }))}>
              📊 Exporter Excel
            </button>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5"
              disabled={!rows.length}
              onClick={() => import('../../utils/excelExport').then((m) => m.exportToPdf({
                title: 'Historique',
                subtitle: `Généré le ${new Date().toLocaleDateString('fr-FR')} — ${rows.length} événement(s)`,
                columns: HISTORIQUE_EXPORT_COLUMNS,
                rows,
                filename: 'historique',
                ecole,
              }))}
            >
              <FileDown size={15} /> Exporter PDF
            </button>
          </div>
        </div>
        <DataTable
          loading={loading} error={error} onRetry={reload} rows={rows}
          pageSize={25}
          emptyLabel="Aucun événement pour ces filtres."
          columns={[
            { key: 'date', label: 'Date', sortable: true, render: (r) => new Date(r.date).toLocaleDateString('fr-FR') },
            { key: 'type', label: 'Type', sortable: true, render: (r) => <Badge tone={TYPE_TONE[r.type] || 'slate'}>{TYPE_LABEL[r.type] || r.type}</Badge> },
            { key: 'eleve', label: 'Élève', sortValue: (r) => `${r.eleve_nom || ''} ${r.eleve_prenom || ''}`, render: (r) => `${r.eleve_prenom || ''} ${r.eleve_nom || ''}`.trim() || '—' },
            { key: 'titre', label: 'Événement' },
            { key: 'detail', label: 'Détail', render: (r) => r.detail || '—' },
            ...(scope === 'admin' ? [{ key: 'auteur', label: 'Auteur', render: (r) => r.auteur || '—' }] : []),
          ]}
          renderExpanded={(r) => {
            const Icon = TYPE_ICON[r.type];
            return (
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm px-2">
                <p className="flex items-center gap-2 text-slate-600">
                  {Icon && <Icon size={14} className="text-slate-400" />}
                  <span className="font-semibold text-slate-900">{r.titre}</span>
                </p>
                <p className="flex items-center gap-2 text-slate-600">
                  <CalendarCheck size={14} className="text-slate-400" />
                  {new Date(r.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
                {(r.eleve_nom || r.eleve_prenom) && (
                  <p className="flex items-center gap-2 text-slate-600">
                    <User size={14} className="text-slate-400" /> {`${r.eleve_prenom || ''} ${r.eleve_nom || ''}`.trim()}
                  </p>
                )}
                {r.detail && (
                  <p className="flex items-center gap-2 text-slate-600">
                    <Tag size={14} className="text-slate-400" /> {r.detail}
                  </p>
                )}
                {r.auteur && (
                  <p className="flex items-center gap-2 text-slate-600 sm:col-span-2">
                    <User size={14} className="text-slate-400" /> Enregistré par <span className="font-medium text-slate-900">{r.auteur}</span>
                  </p>
                )}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}
