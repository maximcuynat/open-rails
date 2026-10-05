# Open Rails 🚄

> **Éditeur et simulateur de voies ferrées vectoriel sur canvas infini.**  
> Conçu selon les normes ferroviaires réelles (HO 1:87, UIC, continuité tangentielle $G^1$, physique de bogies et rames articulées réversibles).

🌐 **Démo en ligne** : [https://maximcuynat.github.io/open-rails/](https://maximcuynat.github.io/open-rails/)

---

## ✨ Fonctionnalités clés

- **Tracé de voies** :
  - Continuité tangentielle ($G^1$) entre sections droites et courbes ; un coude de plus de 15° est signalé et n'est pas franchissable.
  - Aiguillages, traversées, voies parallèles, heurtoirs en bout de voie.
  - **Niveaux de voie** : ponts, tunnels et rampes, avec leur pente en ‰.
  - Cotations en direct (rayon, longueur, angle, entraxe) et saisie d'une longueur exacte au clavier.
- **Trains** :
  - Rames TGV articulées (**Duplex** et **TGV M**) construites véhicule par véhicule sur la voie, attelage et dételage.
  - Plusieurs trains sur le réseau, arrêt au contact d'un autre train ou d'un heurtoir.
- **Conduite réaliste** (à l'échelle 1:1) :
  - Masse, puissance, adhérence et résistance à l'avancement ; la pente et les courbes comptent.
  - Frein à air (conduite générale, cylindres de frein, manomètres), frein électrique, freinage d'urgence.
  - Console de conduite qui s'adapte à la taille de la fenêtre.
- **Limites de vitesse, dévers et déraillement** :
  - Zones de vitesse posées sur la voie, vitesse de ligne, annonce de la prochaine limite.
  - Dévers calculé par courbe ; une courbe prise trop vite fait dérailler la rame.
  - Pentes et dévers visibles sur le plan (chevrons, rail extérieur surligné, caisse qui penche).
- **Signalisation** :
  - Niveau standard : signaux de block et de trajectoire, cantons, réservation du trajet.
  - Niveau pro *(expérimental)* : signaux français, ralentissements, vitesse en cabine sur ligne à grande vitesse.
- **Réseaux d'exemple** (Fichier ▸ Exemples), dont la gare de Marseille Saint-Charles d'après OpenStreetMap.
- **Export & sauvegarde** : sauvegarde automatique dans le navigateur, import / export JSON, export SVG et PNG.
- **Raccourcis clavier reconfigurables** et thèmes clair / sombre.

> Le **pupitre sur téléphone** *(expérimental)* ne fonctionne que lorsque l'application tourne en local (`npm run dev`), pas sur la démo en ligne.

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
| <kbd>S</kbd> | Limite de vitesse |
| <kbd>B</kbd> | Signal de block (sémaphore au niveau pro) |
| <kbd>J</kbd> | Signal de trajectoire (carré au niveau pro) |
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
| <kbd>F5</kbd> | Prendre les commandes / les rendre |
| <kbd>A</kbd> / <kbd>D</kbd> ou <kbd>↑</kbd> / <kbd>↓</kbd> | Manipulateur : un cran de plus / de moins (traction P1…P5, frein électrique B1…B5) |
| <kbd>Q</kbd> (maintenir) | Desserrer le frein à air |
| <kbd>E</kbd> (maintenir) | Serrer le frein à air |
| <kbd>W</kbd> / <kbd>S</kbd> ou <kbd>Maj</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> | Inverseur (avant · neutre · arrière) |
| <kbd>Retour arrière</kbd> | Freinage d'urgence |
| <kbd>←</kbd> / <kbd>→</kbd> | Orienter le prochain aiguillage |
| <kbd>Espace</kbd> | Quitter la conduite |
| <kbd>F3</kbd> | Squelette debug des trains |

Les lettres de conduite désignent la **position** des touches d'un clavier QWERTY (sur un clavier AZERTY : <kbd>Q</kbd>/<kbd>D</kbd>, <kbd>A</kbd>/<kbd>E</kbd>, <kbd>Z</kbd>/<kbd>S</kbd>). Tous les raccourcis se modifient dans **Paramètres ▸ Raccourcis**.

Pour démarrer un train : <kbd>F5</kbd>, inverseur vers l'avant, maintenir « desserrer le frein » jusqu'à 5 bar, puis monter le manipulateur.

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
