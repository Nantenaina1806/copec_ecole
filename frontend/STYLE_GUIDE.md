# Charte & librairie de composants — Frontend Copec

Ce document décrit la charte visuelle commune et les composants partagés (`src/components/`)
à réutiliser dans toutes les sections (D, E, et le reste de l'équipe). Objectif : que chaque
nouvel écran ressemble aux autres sans qu'on ait à se poser la question à chaque fois.

Rien ci-dessous n'a changé de signature par rapport à l'existant : tous les composants déjà
utilisés dans l'appli continuent de fonctionner à l'identique. Ce qui est documenté ici, ce sont
soit des usages déjà en place, soit des ajouts (props optionnelles, nouveaux composants).

---

## 1. Charte graphique

### Couleurs (`tailwind.config.js`)

| Rôle | Classe Tailwind | Usage |
|---|---|---|
| Bleu principal (marque) | `brand-50` → `brand-950` | Boutons primaires, liens actifs, icônes de marque, sidebar (`brand-950`) |
| Or / accent | `accent-400` → `accent-700` | Élément actif de la sidebar, mises en avant ponctuelles — **à utiliser avec parcimonie**, jamais comme couleur de fond principale d'une page |
| Gris chaud (neutre) | `slate-50` → `slate-950` | Texte, bordures, fonds neutres — remplace le gris froid par défaut de Tailwind, ne pas réintroduire de gris froid custom |
| États | `emerald-*` (succès), `red-*` (erreur/danger), `amber-*` (avertissement) | Badges, boutons, alertes |

**Règle d'or : ne jamais coder une couleur en dur** (`#215c94`, `bg-blue-600`, etc.). Toujours passer
par `brand-*` / `accent-*` / `slate-*`. Si une nuance manque, l'ajouter dans `tailwind.config.js`
plutôt que de la coder en inline — sinon un futur changement de palette ne retentera pas cet écran.

### Typographie

- `font-sans` (Inter) : texte courant, formulaires, tableaux — c'est la police par défaut, pas besoin de la préciser.
- `font-display` (Manrope) via la classe `.heading` ou `font-display font-bold` : titres de section, valeurs de StatCard.
- `font-mono` via `.data-mono` : identifiants, matricules, montants tabulaires, horloge (`Topbar`).

### Classes utilitaires globales (`src/styles/index.css`)

Déjà définies, à réutiliser plutôt que de réécrire des styles inline :

`.btn` / `.btn-primary` / `.btn-secondary` / `.btn-danger` / `.btn-ghost`, `.card`, `.input`,
`.label`, `.table-base`, `.badge`, `.heading`, `.data-mono`.

### Responsive

- Breakpoint principal : `md:` (≥768px) pour bascule mobile/desktop (sidebar, topbar, grilles de StatCard).
- Toute nouvelle page/section doit rester utilisable en dessous de 768px (empilement vertical,
  `overflow-x-auto` pour les tableaux larges — voir `DataTable`).
- Respecter `prefers-reduced-motion` : c'est déjà géré globalement dans `index.css`, pas besoin d'y repenser composant par composant.

### Accessibilité — principes appliqués dans toute la librairie

- Tout élément cliquable non textuel a un `aria-label`.
- Les listes déroulantes (menus, notifications) se ferment au clic extérieur **et** à `Échap`.
- Les modales piègent le focus et le restaurent à la fermeture (voir §3 `Modal`).
- Les icônes purement décoratives portent `aria-hidden="true"`.
- Le contraste texte/fond suit la palette `slate` (jamais de `slate-300` ou plus clair pour du texte informatif).

---

## 2. Composants d'affichage

### `StatCard` (`components/StatCard.jsx`)

```jsx
<StatCard label="Élèves inscrits" value={342} icon={<Users size={18} />} tone="brand" />
<StatCard label="En retard" value={12} tone="red" trend={{ delta: -3, invert: true }} onClick={() => filtrer('retard')} />
```
`tone` : `brand` | `accent` | `red` | `slate`. `onClick` rend la carte focusable/cliquable
automatiquement (bouton natif + anneau de focus) — ne pas envelopper vous-même la carte dans un `<button>`.

### `DataTable` (`components/DataTable.jsx`)

```jsx
<DataTable
  caption="Liste des élèves inscrits"           // optionnel, lecteurs d'écran uniquement
  columns={[
    { key: 'nom', label: 'Nom', sortable: true },
    { key: 'classe', label: 'Classe', render: (row) => <Badge>{row.classe}</Badge> },
  ]}
  rows={eleves}
  loading={loading} error={error} onRetry={reload}
  emptyLabel={{ title: 'Aucun élève', description: 'Ajoutez le premier élève de cette classe.', action: <button className="btn-primary">Ajouter</button> }}
  pageSize={20}
  actions={(row) => <button className="btn-ghost">Modifier</button>}
/>
```
- `loading` affiche désormais une **silhouette de tableau** (`SkeletonTable`) plutôt qu'un spinner plein écran — la mise en page ne "saute" plus quand les données arrivent.
- `emptyLabel` accepte soit une chaîne simple (comme avant), soit `{ title, description, icon, action }` pour un état vide plus riche (voir `EmptyState` ci-dessous).
- Les colonnes `sortable` sont accessibles au clavier et annoncent le tri courant (`aria-sort`).

### `Modal` (`components/Modal.jsx`)

```jsx
<Modal open={open} onClose={() => setOpen(false)} title="Modifier l'élève" wide>
  <form>...</form>
</Modal>
```
- Piège le focus à l'intérieur, se ferme à `Échap` (désactivable via `closeOnEscape={false}` — utile si la modale contient elle-même un champ qui utilise Échap, ex. un select natif ouvert), et rend le focus au bouton qui l'a ouverte.
- Le contenu défile indépendamment de l'en-tête si le formulaire est plus long que l'écran (utile sur mobile).
- Rien à changer dans les appels existants pour bénéficier de ces améliorations.

### États de chargement / erreur / vide (`components/Feedback.jsx`)

```jsx
import { LoadingScreen, ErrorState, EmptyState, Skeleton, SkeletonText, SkeletonCard, SkeletonStatCards, SkeletonTable } from '../../components/Feedback';

if (loading) return <SkeletonStatCards count={4} />;   // ou SkeletonCard / SkeletonTable / LoadingScreen selon le contexte
if (error) return <ErrorState message={error} onRetry={reload} />;
if (!data.length) return <EmptyState icon={Inbox} title="Aucune actualité" description="Publiez la première actualité de l'école." action={<button className="btn-primary">Publier</button>} />;
```
- Préférez une silhouette (`Skeleton*`) à `LoadingScreen` dès que la mise en page finale est connue à l'avance (StatCards, tableau, carte) — c'est plus "pro" et évite le saut visuel. `LoadingScreen` reste adapté pour un chargement de page entière (route lazy, `Suspense`).
- `EmptyState` remplace les `<p className="text-sm text-slate-400 text-center py-12">Aucune donnée…</p>` écrits à la main dans plusieurs sections — mêmes espacements que `LoadingScreen`/`ErrorState`, pour une transition visuelle cohérente entre les trois états dans un même conteneur.

### `Badge` (`components/Shared.jsx`)

```jsx
<Badge tone="green">Actif</Badge>   // tone: slate | green | red | amber | brand | violet
```

---

## 3. Formulaires (`components/Shared.jsx`)

Nouveaux champs labellisés, pour éviter de ré-écrire `<label>` + `<input className="input">` +
message d'erreur à la main dans chaque formulaire. Tous gèrent automatiquement l'`id`, le lien
`label`/champ, et l'association du message d'erreur (`aria-describedby`) :

```jsx
<TextInput label="Nom" required value={nom} onChange={(e) => setNom(e.target.value)} error={errors.nom} />
<SelectInput label="Classe" value={classeId} onChange={(e) => setClasseId(e.target.value)}>
  <option value="">— Choisir —</option>
  {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
</SelectInput>
<TextareaInput label="Remarques" hint="Visible uniquement par l'administration." rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
<Checkbox label="Envoyer une notification aux parents" checked={notifier} onChange={(e) => setNotifier(e.target.checked)} />
```

Pour un champ personnalisé qui ne rentre pas dans ces cas (ex. `MontantInput`, un sélecteur de
date custom…), utiliser directement `FormField` :

```jsx
<FormField label="Montant" htmlFor="montant-paie" required error={errors.montant}>
  <MontantInput value={montant} onChange={setMontant} required />
</FormField>
```

`SearchInput` reste utilisable tel quel (`value`/`onChange`/`placeholder`) ; il a gagné une icône
loupe, un bouton "effacer" quand il y a du texte, et un `label` optionnel pour un intitulé
accessible plus explicite que le placeholder :

```jsx
<SearchInput value={search} onChange={setSearch} placeholder="Nom, prénom, email…" label="Rechercher un compte" />
```

`MontantInput` est inchangé (montant en Ariary, séparateurs de milliers automatiques).

---

## 4. Navigation (`Sidebar`, `Topbar`)

Ces deux composants sont communs à tout l'espace admin/agent — ils ne devraient pas être modifiés
section par section. Pour ajouter une nouvelle section au menu, voir `SECTIONS` et `GROUPS` en
haut de `Sidebar.jsx` (un item = une clé dans `SECTIONS`, rangée dans un groupe de `GROUPS`).

Ce qui a été renforcé ici (sans rien changer à l'usage) : navigation au clavier complète (groupes
repliables avec `aria-expanded`, lien actif annoncé via `aria-current="page"`), et les deux menus
du `Topbar` (notifications, compte) se ferment désormais tous les deux au clic extérieur et à
`Échap`.

---

## 5. Bonnes pratiques pour la suite

1. **Ne pas dupliquer** : avant d'écrire un nouveau `<div className="card">...` ou un état vide
   fait main, vérifier si `StatCard`, `DataTable`, `EmptyState`, `Skeleton*` ou les champs de
   `Shared.jsx` couvrent déjà le besoin.
2. **Étendre plutôt que copier-coller** : si un composant partagé manque légèrement d'une option
   (une nouvelle `tone`, une prop d'affichage), l'ajouter dans le composant partagé (avec une
   valeur par défaut qui ne change rien aux usages existants) plutôt que de dupliquer le fichier.
3. **Couleurs et espacements** : toujours passer par les classes `brand-*` / `accent-*` / `slate-*`
   et les classes utilitaires (`.card`, `.input`, `.badge`…) — jamais de couleur ou de style codé en dur.
4. **Accessibilité par défaut** : tout nouvel élément interactif doit être un `<button>`/`<a>` réel
   (jamais un `<div onClick>`), avec un `aria-label` si son contenu n'est pas un texte explicite.
