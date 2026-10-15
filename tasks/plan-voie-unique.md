# Trains pilotés sur une ligne à une voie — essais et suite

Demande du 2026-10-11 : que fait le pilote automatique sur une voie unique parcourue dans les
deux sens (lignes de TER), et comment le gérer. La règle réelle est dans
`tasks/recherche-voie-unique.md` (5 octobre) ; ce fichier dit ce que les essais ont montré, ce
qui est corrigé et ce qui reste.

## Banc d'essai

`PROFILE=1 npx vitest run tools/perf/explore-single-track.test.ts --silent=false` (`WHY=1` : ce
que chaque train attend à la fin ; `ONLY=<texte>` : un scénario). Ligne de 12 km, un évitement de
600 m à chaque bout et un au milieu (`src/application/game/singleTrack.testkit.ts`), rames TGV
Duplex pilotées, aide « aiguilles automatiques ». Trois signalisations : aucune, les six signaux
d'un évitement posés à la main, celle qu'un import pose (`layAutomaticSignals`, donc celle du jeu
de données).

## Résultats

| Scénario | Avant | Après |
|---|---|---|
| Deux trains face à face, signaux | bloqués (même voie de l'évitement) | arrivés en 569 s |
| Face à face avec arrêt au milieu, signaux | bloqués | arrivés en 601 s |
| Deux qui se suivent, un en face, signaux | bloqués | arrivés en 753 s (import), 836 s (six signaux) |
| Trois trains dont un parti du milieu, signaux | bloqués | **bloqués** : évitement plein |
| Deux contre deux, signaux | bloqués | **bloqués** : évitement plein |
| Sans aucun signal | nez à nez à 11 m, ou accrochage à l'aiguille | **inchangé** : rien ne protège |

Avec des signaux il n'y a jamais eu de collision ni de nez à nez : l'enclenchement de sens du
moteur (`opposedBeyond`) tient. Ce qui manquait était du ressort du régulateur.

## Corrigé

- [x] **Voie de croisement** — le trajet d'un train évite la voie qu'un autre parcourt en sens
      inverse ou occupe à l'arrêt (`domain/services/crossingRules.ts`, un péage dans la recherche
      de chemin : `TrackPathOptions.toll`). Le premier garde la voie directe, le second prend
      l'évitement ; un train seul reste sur la voie directe.
- [x] **Aiguilles disputées** — l'aide ne tourne plus une aiguille vers une voie d'où un train
      arrive sur elle (`metBeyond`) : deux trains se la renvoyaient chaque seconde.
- [x] **Trajet refait quand on est retenu** — un train arrêté 15 s avant son arrêt cherche son
      chemin de nouveau (un quai pris entre-temps).
- [x] **Quai pris** (signalé à l'écran le 2026-10-11 : la rame visait le quai où l'autre
      attendait, la voie d'à côté libre) — la voie sous une rame compte comme prise dans le sens
      où elle va repartir, des deux sens si elle n'a nulle part où aller ; un train regarde toutes
      les 5 s si une rame stationne sur ses 4 km à venir et refait son trajet avant d'avoir à
      s'arrêter. À Laragne, voie D occupée : le TER arrive voie E sans perdre de temps (994 s
      contre 993 s seul).
- Essayé et écarté : « tenir sa gauche » aux aiguilles prises en pointe. Fonctionne sans rien
  savoir des autres, mais envoie un train seul par chaque évitement à la vitesse de l'aiguille
  (623 s au lieu de 569 s sur l'essai).

Tests : `domain/services/crossingRules.test.ts`, `application/game/crossing.test.ts`.

## Sur le vrai réseau : Sisteron – Laragne-Montéglin (ligne des Alpes)

`PROFILE=1 npx vitest run tools/perf/explore-ligne-des-alpes.test.ts --silent=false` (`TRACE=1` :
aiguilles, signaux et positions ; `JOURNEYS="A>B|C>D"` : d'autres trains). TER Régiolis pilotés,
morceaux `ligne-905000-01` et `-02` du jeu de données.

La section fait 18,9 km à une voie, avec un évitement de 570 m au km 11,5 depuis Sisteron ; les
signaux sont ceux de l'import : un carré avant chaque aiguille, des signaux de cantonnement par
paires tous les 1 600 m environ.

| Essai | Résultat |
|---|---|
| Un TER seul | arrivé en 993 s |
| Un de chaque bout, partis ensemble | arrivés en 1 231 s, croisement à l'évitement du km 11,5 |
| Deux qui se suivent depuis Sisteron, un en face | arrivés en 1 380 s |
| Serres → Château-Arnoux (56 km, deux arrêts) | arrivé en 2 437 s, croise un TER à quai à Sisteron |

- Le deuxième essai bloquait d'abord : les deux trains à l'évitement, chacun sur sa voie, se
  renvoyaient l'aiguille. La parade ne regardait que le rail voisin de l'aiguille, or les rails
  importés font 60 m : elle suit maintenant la voie jusqu'à la prochaine aiguille (4 km au plus).
- À voir : dans le dernier essai, le train parti de Château-Arnoux n'a gardé que Sisteron dans
  son itinéraire (Laragne et Serres n'y sont pas entrés, sans message). Non cherché.

## Reste

- [ ] **V1 — Une place à l'arrivée** (règle 5 de la recherche) : un train ne s'engage vers un
      évitement que s'il y aura une voie libre pour lui, compte tenu de ceux qui y sont ou y vont.
      C'est ce qui débloque « trois trains » et « deux contre deux ». À décider : dans le moteur de
      signalisation (vaut aussi pour le joueur) ou dans le pilote (trains du jeu seulement).
- [ ] **V2 — Sans signaux** : le pilote ne sait pas se protéger seul. Soit il refuse de partir
      sur un réseau sans signaux quand d'autres trains roulent, soit on propose de poser la
      signalisation automatique. Le jeu de données en a toujours.
- [ ] **V3 — Autres lignes à une voie** : Nice – Breil, Cannes – Grasse (Sisteron – Laragne est fait).
