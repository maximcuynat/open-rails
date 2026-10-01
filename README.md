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
  - Contrôle clavier (<kbd>↑</kbd> Accélérer, <kbd>↓</kbd> Freiner, <kbd>←</kbd>/<kbd>→</kbd> Aiguillage).
  - Réversibilité ferroviaire réelle : changement de sens par transfert de cabine (<kbd>R</kbd>).
  - Mode Debug Squelette (<kbd>D</kbd>) affichant les pivots, bielles d'attelage et accordéons.
- **Export & Sauvegarde** :
  - Export vectoriel SVG multi-calques prêt pour l'impression ou la découpe laser.
  - Sauvegarde et chargement de réseaux au format JSON.

---

## ⌨️ Raccourcis Clavier

| Touche | Action |
| :--- | :--- |
| <kbd>V</kbd> | Outil Sélection & Déplacement (Gizmo) |
| <kbd>N</kbd> | Outil Pose de voie droite |
| <kbd>C</kbd> | Outil Courbe |
| <kbd>Y</kbd> | Outil Aiguillage |
| <kbd>H</kbd> | Outil Navigation (Pan) |
| <kbd>Espace</kbd> | Prendre les commandes / Quitter le mode conduite |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Accélérer / Freiner le train |
| <kbd>R</kbd> | Changer de motrice / inverser le sens de marche |
| <kbd>D</kbd> | Activer/Désactiver le mode Squelette (Debug) |
| <kbd>←</kbd> / <kbd>→</kbd> | Aiguiller le train en approche d'une bifurcation |
| <kbd>Suppr</kbd> | Supprimer les éléments sélectionnés |

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

Ce projet est sous licence open-source libre. Consultez le fichier [LICENSE](LICENSE) pour plus de détails.
