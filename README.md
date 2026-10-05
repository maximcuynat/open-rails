# Open Rails 🚄

> **Éditeur et simulateur de voies ferrées vectoriel sur canvas infini.**  
> Conçu selon les normes ferroviaires réelles (HO 1:87, UIC, continuité tangentielle $G^1$, physique de bogies et rames articulées réversibles).

🌐 **Démo en ligne** : [https://maximcuynat.github.io/open-rails/](https://maximcuynat.github.io/open-rails/)

---

## ✨ Fonctionnalités clés

- **Tracé de voies précis & continu** :
  - Continuité tangentielle stricte ($G^1$ à $10^{-5}$) entre sections droites et courbes de Bézier quadratiques.
  - Deux modes de pose : **Catalogue Kato Unitrack HO** ou **Voie libre 100% (Flex)**.
  - Aiguillages automatiques, croisements à niveau et doubles voies parallèles.
- **Cotations CAD temps réel & Gizmo 2D** :
  - Affichage instantané des rayons ($R$), longueurs ($L$), angles ($\theta$) et entraxes de voies.
  - Gizmo orthogonal 2D pour translater précisément les nœuds et aiguillages sur les axes X ou Y.
- **Atelier Train & Simulation cinématique** :
  - Rame TGV complète et réversible : motrice de tête $M_1$, voitures voyageurs articulées, motrice de queue $M_2$.
  - Glisser-déposer fluide (Pointer Drag & HTML5 Drag & Drop) des motrices et voitures sur les rails.
  - Modèle cinématique rigoureux : bogies en retrait ($3{,}04\,\text{m}$), axes orientés tournants avec la voie, soufflets d'accordéons élastiques ancrés sur les parois latérales.
- **Mode Conduite dynamique** :
  - Vitesse en temps réel jusqu'à $500\,\text{km/h}$.
  - Contrôle clavier (<kbd>F5</kbd> pour prendre les commandes, <kbd>↑</kbd>/<kbd>↓</kbd> crans de traction et de freinage, <kbd>←</kbd>/<kbd>→</kbd> Aiguillage).
  - Réversibilité ferroviaire réelle : inverseur avant / neutre / arrière (<kbd>Maj</kbd> + <kbd>↑</kbd>/<kbd>↓</kbd>).
  - Mode Debug Squelette (<kbd>D</kbd>) affichant les pivots, bielles d'attelage et accordéons.
- **Export & Sauvegarde** :
  - Export vectoriel SVG multi-calques prêt pour l'impression ou la découpe laser.
  - Sauvegarde et chargement de réseaux au format JSON.

---

## ⌨️ Raccourcis Clavier

| Touche | Action |
| :--- | :--- |
| **Outils** | |
| <kbd>V</kbd> | Sélection et déplacement |
| <kbd>N</kbd> | Voie droite |
| <kbd>C</kbd> | Voie courbe |
| <kbd>P</kbd> | Aiguillage |
| <kbd>K</kbd> | Ciseaux (scinder une voie) |
| <kbd>M</kbd> | Règle (mesurer) |
| <kbd>H</kbd> | Déplacer la vue |
| <kbd>L</kbd> | Trains (pose et sélection) |
| **Pose des voies** | |
| <kbd>0</kbd>–<kbd>9</kbd> puis <kbd>Entrée</kbd> | Saisir la longueur exacte de la voie droite en cours |
| <kbd>Tab</kbd> | Continuer en courbe depuis le nœud de la voie droite en cours |
| <kbd>Échap</kbd> | Annuler la pose en cours, puis revenir à l'outil Sélection |
| **Édition** | |
| <kbd>T</kbd> | Basculer l'aiguillage sélectionné |
| <kbd>D</kbd> | Créer une voie parallèle à la sélection |
| <kbd>R</kbd> | Réconcilier les jonctions et aiguillages |
| <kbd>Suppr</kbd> ou <kbd>Retour arrière</kbd> | Supprimer la sélection |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> | Tout sélectionner |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | Annuler |
| <kbd>Ctrl</kbd> + <kbd>Maj</kbd> + <kbd>Z</kbd> ou <kbd>Ctrl</kbd> + <kbd>Y</kbd> | Rétablir |
| **Affichage** | |
| <kbd>Espace</kbd> + glisser | Déplacer la vue |
| <kbd>F</kbd> | Ajuster tout le réseau à la vue |
| <kbd>Ctrl</kbd> + <kbd>0</kbd> | Zoom par défaut |
| <kbd>G</kbd> | Activer / désactiver l'aimantation |
| <kbd>I</kbd> | Afficher / masquer l'inspecteur |
| <kbd>Ctrl</kbd> + <kbd>,</kbd> ou <kbd>,</kbd> | Paramètres du réseau (échelles, unités) |
| **Conduite** | |
| <kbd>F5</kbd> | Entrer en mode conduite / le quitter |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Manipulateur : un cran de traction / de freinage |
| <kbd>Maj</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | Inverseur (avant · neutre · arrière) |
| <kbd>Retour arrière</kbd> | Arrêt d'urgence |
| <kbd>←</kbd> / <kbd>→</kbd> | Orienter le prochain aiguillage |

---

## 🛠️ Installation & Démarrage local

```bash
# Cloner le dépôt
git clone https://github.com/maximcuynat/open-rails.git
cd open-rails

# Installer les dépendances
npm install

# Lancer le serveur de développement (port 8900)
npm run dev

# Lancer la suite de tests unitaires (Vitest)
npm test

# Compiler pour la production
npm run build
```

---

## 🏗️ Architecture technique

Le projet applique les principes de la **Clean Architecture** et du **Domain-Driven Design (DDD)** :

```text
src/
├── domain/            # Logique métier pure (Network, Locomotive, Géométrie, Pathfinding)
├── application/       # Gestion d'état et commandes (EditorStore, ToolStrategy)
├── infrastructure/    # Moteur de rendu Canvas 2D, export SVG, persistance
└── presentation/      # Composants React 18, palette de construction, overlays
```

---

## 📄 Licence

Copyright © 2026 Maxim Cuynat.

Open Rails est un logiciel libre distribué sous licence [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Vous pouvez l'utiliser, l'étudier, le modifier et le redistribuer ; toute version modifiée que vous distribuez ou que vous mettez à disposition sur un réseau doit être publiée sous la même licence, avec son code source.
