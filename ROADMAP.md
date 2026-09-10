# Roadmap — open-rails

> Éditeur de rails sur canvas infini.
> Stack : React 18 + TypeScript + Vite 5 + Vitest.
> Dev server : `http://localhost:8900/`

## État actuel

| Composant | Statut |
|---|---|
| Scaffolding projet (Vite, TS, React) | Fait |
| Serveur dev port 8900 | Fait |
| Canvas infini (pan + zoom) | Fait |
| Grille adaptive (minor/major) | Fait |
| Barre d'échelle adaptative | Fait |
| HUD (zoom + position caméra) | Fait |
| Thèmes light/dark | Fait |
| Modèle de données (Point, Node, Segment, Network) | Fait |
| Placement de nœuds avec snap grille | Fait |
| Rendu rails détaillés (double file + traverses) | Fait |
| Rendu simplifié (trait unique) quand dézoomé | Fait |
| Sélection nœuds et segments | Fait |
| Suppression (Delete/Backspace) | Fait |
| Barre d'outils (Place, Curve, Select, Snap) | Fait |
| Raccourcis clavier (N, C, V, G, Esc, Del) | Fait |
| Tests unitaires (41 tests) | Fait |
| Preview rail en direct (courbes) | Fait |
| Contraintes de courbure (rayon min 150m) | Fait |
| Clamping du point via | Fait |
| Mesures en direct (longueur, rayon) | Fait |
| Courbes Bezier quadratique (3 clics: start → via → end) | Fait |
| Rendu courbes détaillé (double rail + traverses + ballast) | Fait |
| Rendu courbes simplifié (quadraticCurveTo) | Fait |
| Hit-test sur courbes | Fait |
| Preview courbe en temps réel | Fait |

---

## Phase 0 — Fondations visuelles ✅

- [x] Initialiser le projet (Vite + React + TS)
- [x] Configurer le serveur dev sur le port 8900
- [x] Canvas plein écran avec pan (pointer drag) et zoom (wheel, cursor-anchored)
- [x] Grille infinie adaptive (espacement logarithmique 1/2/5 × 10^n)
- [x] Marqueur d'origine (croix au point 0,0)
- [x] Barre d'échelle en bas à droite (s'adapte au zoom)
- [x] HUD (niveau de zoom + position caméra)
- [x] Support light/dark via CSS variables + `prefers-color-scheme`
- [x] Gestion DPR (Retina) via `setTransform`

---

## Phase 1 — Modèle de données et placement de base ✅

**Objectif :** pouvoir dessiner une ligne brisée à la souris, snapée sur la grille.

- [x] Définir les types du domaine dans `src/core/types.ts` :
  - `Point` (x, y)
  - `Node` (id, position: Point)
  - `Segment` (id, from: NodeId, to: NodeId, type: 'straight')
  - `Network` (nodes: Map<NodeId, Node>, segments: Segment[])
- [x] Stockage de l'état du réseau (React ref + redraw à la demande)
- [x] Outil **placer un nœud** :
  - [x] Clic gauche ajoute un nœud snapé sur la grille
  - [x] Clic successif relie automatiquement le nœud précédent au nouveau
  - [x] Échap ou clic droit termine la chaîne en cours
- [x] Snap sur la grille (toggle on/off, touche `G`)
- [x] Rendu des nœuds (cercle avec anneau) par-dessus la grille
- [x] Rendu des segments — deux niveaux de détail :
  - [x] Zoomé : deux files de rail (écartement standard 1.435 m) + traverses + ballast
  - [x] Dézoomé (scale < 8) : trait simple pour optimiser
- [x] Hit-test basique : clic sur un nœud ou segment
- [x] Sélection simple : clic sur élément → sélectionné (surbrillance accent)
- [x] Suppression : touche `Delete` / `Backspace` sur la sélection
- [x] Tests unitaires : `network.test.ts` (18 tests — ajout, suppression, snap, hit-test)

**Livrable :** on peut dessiner une ligne brisée snapée, sélectionner et supprimer.

---

## Phase 2 — Courbes et types de rails ✅ (itération 2 en cours)

**Objectif :** tracer des rails droits et courbes, les mélanger.

### Itération 1 — base fonctionnelle ✅

- [x] Type `Segment` étendu : `kind: 'straight' | 'curve'` avec `via?: Point`
- [x] Rail courbe — Bezier quadratique :
  - [x] Défini par 3 points (start, via, end)
  - [x] Discrétisation en segments pour le rendu (`discretizeCurve`)
  - [x] Normale calculée à chaque point pour offset des deux files de rail
- [x] Outil **courbe** dans la barre d'outils :
  - [x] Mode 3 clics : start → via (point de contrôle) → end
  - [x] Preview pointillés + marqueurs
  - [x] Clic droit ou Échap annule la courbe en cours
- [x] Hit-testing sur les courbes (`distToCurve`, discrétisée)
- [x] Rendu détaillé des courbes : double rail + traverses orientées + ballast
- [x] Rendu simplifié : `quadraticCurveTo` natif du canvas
- [x] Tests : `curve.test.ts` (14 tests)

### Itération 2 — preview rail en direct + contraintes ✅

- [x] **Preview rail en direct** : pendant le placement de la courbe, affichage
      du vrai rendu du rail (double file + traverses) en temps réel.
- [x] **Contraintes de courbure** :
  - [x] Calcul du rayon de courbure minimum le long de la Bezier (formule
        analytique : R = |B'|³ / |B' × B''|)
  - [x] Rayon minimum configurable (défaut : 150 m)
  - [x] Feedback visuel : la courbe vire au rouge/orange si rayon sous le seuil
  - [x] Affichage du rayon et de la longueur près du curseur
- [x] **Contrôle du point via** :
  - [x] `clampVia` : le point de contrôle est rapproché du milieu de la corde
        (binary search) pour respecter le rayon minimum
  - [x] Le via clampé est sauvegardé dans le segment final
  - [x] Position d'origine du via affichée en semi-transparent + position clampée
        en orange si différentes
- [x] **Mesures en direct** :
  - [x] Longueur de la courbe pendant le placement
  - [x] Rayon de courbure minimum
- [x] Tests : `curve.test.ts` (23 tests — Bezier, tangente, normale,
      discrétisation, longueur, hit-test, rayon, clamping)

**Livrable :** on trace une courbe avec rendu rail live, et on voit si elle
respecte les contraintes physique avant de valider.

---

## Phase 3 — Aiguillages (switches / turnouts)

**Objectif :** poser des aiguillages et les basculer.

- [ ] Type `Switch` (node spécial) :
  - [ ] `id`, `position: Point`, `position: 'left' | 'right'`
  - [ ] Une entrée (stem) + deux sorties (straight, diverging)
  - [ ] Référence vers les 3 segments connectés
- [ ] Rendu visuel de l'aiguillage :
  - [ ] Branches dessinées selon la position active
  - [ ] Branche inactive en pointillé ou gris clair
- [ ] Bascule de l'aiguillage :
  - [ ] Clic sur l'aiguillage → toggle
  - [ ] Touche `T` quand l'aiguillage est sélectionné
- [ ] Animation optionnelle de la transition (lerp de la position)
- [ ] Outil **aiguillage** dans la barre d'outils
- [ ] Gabarits préfabriqués communs :
  - [ ] Aiguillage simple gauche/droite
  - [ ] Aiguillage symétrique (Y)
  - [ ] Traversée-jonction double (TJD)
- [ ] Tests : `switch.test.ts` (toggle, connexions)

**Livrable :** réseau avec aiguillages fonctionnels.

---

## Phase 4 — Édition riche

**Objectif :** édition confortable, construction d'un réseau complet.

- [ ] Multi-sélection :
  - [ ] Shift+clic pour ajouter/retirer de la sélection
  - [ ] Rectangle de sélection (drag en mode sélection)
  - [ ] Ctrl+A pour tout sélectionner
- [ ] Déplacement :
  - [ ] Drag d'un nœud unique
  - [ ] Drag d'un groupe de nœuds (connexions suivent)
- [ ] Annuler / refaire :
  - [ ] Stack d'états (history) comme orbit-lab
  - [ ] Ctrl+Z / Ctrl+Shift+Z
  - [ ] Limite de profondeur (50 états)
- [ ] Copier / coller :
  - [ ] Ctrl+C / Ctrl+V (coller au curseur ou au centre)
  - [ ] Ctrl+D pour dupliquer
- [ ] Raccourcis clavier :
  - [ ] `V` outil sélection, `N` nœud, `C` courbe, `S` aiguillage, `Suppr`
  - [ ] `G` toggle snap grille, `F` ajuster la vue (fit all)
- [ ] Hit-test avec marge de tolérance (plus facile de cliquer)
- [ ] Tests : `history.test.ts`, `selection.test.ts`

**Livrable :** édition fluide d'un réseau complet.

---

## Phase 5 — Persistance et export

**Objectif :** le travail est sauvegardé et exportable.

- [ ] Sauvegarde automatique en `localStorage` (debounce 1s)
- [ ] Restauration au chargement de l'app
- [ ] Import / export JSON du réseau complet :
  - [ ] Format versionné ( `{ version, network }` )
  - [ ] Drag-and-drop de fichier JSON (comme orbit-lab)
  - [ ] Bouton export (téléchargement)
- [ ] Export SVG du tracé (sans la grille, rails uniquement)
- [ ] Export PNG (rendu canvas à haute résolution)
- [ ] Nom du projet (persistant)
- [ ] Indicateur "modifications non sauvegardées"
- [ ] Tests : `persist.test.ts` (sauvegarde/restauration round-trip)

**Livrable :** sauvegarde fiable + export multi-format.

---

## Phase 6 — UI et ergonomie

**Objectif :** interface complète, utilisable sur desktop et mobile.

- [ ] Barre d'outils latérale ou supérieure :
  - [ ] Sélection, Nœud, Droit, Courbe, Aiguillage, Supprimer
  - [ ] Indicateur visuel de l'outil actif
  - [ ] Tooltips avec raccourci clavier
- [ ] Panel latéral (desktop) :
  - [ ] Propriétés de la sélection (type, position, longueur, angle)
  - [ ] Métriques du réseau (nb nœuds, nb segments, longueur totale)
  - [ ] Liste des calques (si implémenté)
- [ ] Mini-map en bas à gauche (vue d'ensemble du réseau)
- [ ] Raccourcis clavier configurables (comme orbit-lab `keymap.ts`)
- [ ] Support mobile / touch :
  - [ ] Pinch-to-zoom (deux doigts)
  - [ ] Pan à un doigt
  - [ ] Tap pour placer/sélectionner
  - [ ] Barre d'outils adaptée (bottom dock ou radial menu)
- [ ] Tests : `keymap.test.ts`

**Livrable :** interface desktop + mobile complète.

---

## Phase 7 — Fonctions avancées

**Objectif :** aller plus loin selon les besoins.

- [ ] Simulation de circulation :
  - [ ] Train qui suit les rails (vitesse paramétrable)
  - [ ] Respect des aiguillages (suit la branche active)
  - [ ] Sens de circulation bidirectionnel
  - [ ] Multiple trains simultanés
- [ ] Mesures automatiques :
  - [ ] Longueur de chaque segment / courbe
  - [ ] Angle d'inclinaison, rayon de courbure
  - [ ] Longueur totale du réseau
  - [ ] Pente (si élévation ajoutée)
- [ ] Calques (layers) :
  - [ ] Calques nommés, visibilité on/off
  - [ ] Verrouillage de calque
  - [ ] Attribution des éléments à un calque
- [ ] Bibliothèque de gabarits :
  - [ ] Sauvegarder un bout de réseau comme gabarit
  - [ ] Réutilisation par drag-and-drop
  - [ ] Bibliothèque prédéfinie (aiguillages standard, bifurcations)
- [ ] Règles de validation :
  - [ ] Rayon de courbure minimum
  - [ ] Pente maximum
  - [ ] Détection de conflits (segments qui se croisent)
  - [ ] Nœuds orphelins (non connectés)
- [ ] Annotations :
  - [ ] Texte libre sur le canvas
  - [ ] Marqueurs / bornes kilométriques
  - [ ] Cotes (mesures manuelles entre deux points)
- [ ] Élévation / terrain 3D (optionnel, gros scope) :
  - [ ] Axe Z sur les nœuds
  - [ ] Vue en coupe / profil en long
  - [ ] Terrain en arrière-plan (heightmap)

**Livrable :** éditeur de rails complet avec simulation.

---

## Principes techniques

- **Rendu** : Canvas 2D, pas de lib tierce. RAF loop pour la simulation, redraw à la demande pour l'édition.
- **État** : refs pour la camera (muté hors React), state React pour la sélection et l'outil actif. Le réseau peut vivre dans un ref + système de subscribe, comme `useSimulation` dans orbit-lab.
- **Tests** : Vitest, logique pure isolée dans `src/core/`, pas de tests sur le canvas.
- **Structure des dossiers** :
  - `src/core/` — modèle de données, logique pure (network, types, history, persist)
  - `src/render/` — camera, renderer, palette
  - `src/ui/` — composants React (EditorCanvas, Toolbar, Panel, etc.)
- **Pas de dépendance externe** au-delà de React. Pas de state management lib.
- **Performance** : redraw incrémental si le réseau devient large (dirty regions ou spatial index pour le hit-test).
