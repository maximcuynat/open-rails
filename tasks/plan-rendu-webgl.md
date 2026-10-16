# Moteur WebGL2 maison et identité pixel art

Branche `feature/rendu-webgl`, ouverte le 2026-10-16 depuis `developement` (qui ne bouge pas
pendant le chantier). Conception validée et relue :
`~/.gstack/projects/maximcuynat-open-rails/mcuynat-developement-design-20261016-193901.md`
(décisions D1 à D9, tâches T1 à T11). Au début de chaque lot, `developement` est fusionné ici.

## Lots

- [ ] **W0** — Mesure de départ du Canvas 2D dans le navigateur (T1)
  - [x] Banc dans la page (`window.__frameBench()`, `npm run dev` seulement) : 9 gares, 81 gares,
        jeu de données LGV + PACA entier en Lambert-93 (`loadAllLines`)
  - [x] Déplacements à trois zooms fixés (vue entière, niveau `line`, niveau `detail`) et balayage
        de zoom à travers les seuils, rapportés à part : p50 / p95 du temps de dessin et de
        l'écart entre deux images
  - [x] Le même banc lancé par Playwright (`tools/perf/measure-frame.cjs`, rendu logiciel)
  - [ ] Chiffres relevés sur la machine du fondateur, navigateur normal

## Revue W0 (banc)

Premier passage en Chromium sans tête (rendu logiciel, 1600 × 1000), 2026-10-16 :

| Scénario | Rails | Vue | Dessin p50 / p95 (ms) | Écart entre images p50 / p95 (ms) |
|---|---:|---|---|---|
| 9 gares | 13 527 | entier | 2,6 / 3,1 | 52,5 / 58,6 |
| 81 gares | 121 743 | entier | 37,4 / 45,9 | 143,9 / 160,6 |
| 81 gares | 121 743 | balayage | 6 / 42 | 58,7 / 158,7 |
| Réseau réel | 63 738 | line | 3 / 3,5 | 50,5 / 57,7 |

Ce que ça dit : le temps passé dans `paint()` n'est qu'une partie du coût, le Canvas 2D
rastérise après coup (52 ms entre deux images pour 2,6 ms de dessin). **L'écart entre deux
images est la mesure qui compte**, c'est elle que le critère « ÷3 » vise. Sur une vraie carte
graphique il bute à 16,7 ms (60 Hz) : la comparaison des deux moteurs se lit là où le Canvas 2D
dépasse ce plancher (81 gares en vue entière, balayages). Chiffres de la machine du fondateur :
à relever avec `await __frameBench()` dans la console d'une fenêtre ordinaire.
- [ ] **W0b** — Géométrie des voies sortie de `lodTracks.ts`, rendu 2D identique au pixel (T2, D4, D8)
- [ ] **W1** — Contexte WebGL2, caméra, voies, deux canevas, repli, `check-webgl.cjs` (T3-T6, D9)
- [ ] **W2** — Mises à jour partielles par le journal, budget mémoire 128 Mo (T7, D5)
- [ ] **W3** — Trains (atlas, instances)
- [ ] **W4** — Aiguilles, signaux, panneaux, gares, chemin d'itinéraire ; révisions fines (T8, D6)
- [ ] **W5** — Pixel art : palette, tampon réduit, caméra calée (T9, T10, D7)
- [ ] **W6** — Textes en WebGL (T11, D1)
- [ ] **W7** — Couches du monde toutes en WebGL ; décision de fusion sur les critères de réussite

## Revue

(à remplir à la fin de chaque lot)
