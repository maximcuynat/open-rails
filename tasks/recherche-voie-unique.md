Recherche du 2026-10-05, voie unique et signaux à double sens. Lecture seule, aucun code modifié.

# Voie unique et signaux à double sens

Complète `recherche-signalisation.md` (§2, §4, §5) et `recherche-signalisation-niveaux.md` sans les répéter.

Confiance : **C** = confirmé par plusieurs sources indépendantes ; **1** = une seule source ; **E** = estimé ou déduit par moi.

## 0. Lecture rapide

- Environ **45 % du kilométrage de lignes** du réseau national n'a qu'une voie, et **78 % des « petites lignes »** (surtout parcourues par des TER) sont à voie unique. L'intuition de l'utilisateur est juste pour la géographie du réseau, moins pour le volume de trains.
- En France, **un signal ne s'adresse jamais qu'à un seul sens**. Il n'existe pas de signal à deux faces. Une voie parcourue dans les deux sens porte **deux jeux de signaux**, un par sens, chacun tourné vers ses trains et implanté à gauche de son propre sens, donc de part et d'autre de la voie.
- Le nez à nez est empêché par une propriété de la **section entre deux points de croisement** (l'« intervalle »), pas par les signaux pris un à un : un **enclenchement de sens** n'ouvre le signal d'accès que si tout l'intervalle est libre de train de sens contraire, et le reste tant qu'il est occupé.
- Les signaux qui donnent accès à un intervalle sont des signaux d'arrêt **non permissifs** (carrés). Un sémaphore de block franchissable ne convient pas à cet endroit.

## Sources

| Id | Source | URL |
|---|---|---|
| S1 | SNCF, IN 1482, règlement S1A « Signalisation au sol », art. 106, 207, 213, 608 (déjà cité dans `recherche-signalisation.md`) | http://www.rmb.asso.fr/signalisation.pdf |
| S2 | EPSF, document pédagogique « Les signaux, les régimes d'exploitation, les systèmes d'espacement », 2017, §3.3, §3.4, §4.3, §4.4.2 | https://www.securite-ferroviaire.fr/sites/default/files/reglementations/pdf/2023-03/document-pedagogique-signaux-regimes-exploitation-v1.pdf |
| O1 | OSRD (projet libre porté par SNCF Réseau), wiki ferroviaire, « Les lignes à une seule voie », « La voie unique », « La voie banalisée », « Les installations de contresens ». Reprend le texte de S2 : ne compte pas comme source indépendante de S2 | https://osrd.fr/fr/docs/railway-wiki/signalling/operation-modes/ |
| D1 | SNCF Open Data, « Régime d'exploitation des lignes », 1 113 tronçons, mise à jour du 28/03/2024 ; kilométrages calculés par moi sur les PK de début et de fin | https://ressources.data.sncf.com/explore/dataset/regime-dexploitation-des-lignes/ |
| A1 | Assemblée nationale, rapport n° 1080 (XVIe législature) sur les lignes de desserte fine du territoire | https://www.assemblee-nationale.fr/dyn/opendata/RAPPANR5L16B1080.html |
| W6 | Wikipédia FR, Voie unique | https://fr.wikipedia.org/wiki/Voie_unique |
| W7 | Wikipédia FR, Voie banalisée | https://fr.wikipedia.org/wiki/Voie_banalis%C3%A9e |
| W8 | Wikipédia FR, Installation permanente de contre-sens | https://fr.wikipedia.org/wiki/Installation_permanente_de_contre-sens |
| W9 | Wikipédia FR, Voie unique à signalisation simplifiée (article signalé comme insuffisamment sourcé) | https://fr.wikipedia.org/wiki/Voie_unique_%C3%A0_signalisation_simplifi%C3%A9e |
| W4 | Wikipédia FR, Transmission voie-machine | https://fr.wikipedia.org/wiki/Transmission_voie-machine |
| X6 | DocRail, « Les lignes à voie unique », 2024 | https://docrail.fr/les-lignes-a-voie-unique/ |
| J1 | OpenTTD, manuel des signaux et de la pose | https://wiki.openttd.org/en/Manual/Signals |
| J6 | Simutrans, guide des signaux (lu directement cette fois) | https://sourceforge.net/p/simutrans/wiki/Signal%20guide/ |
| J10 | NIMBY Rails, wiki, « Path signal setup » | https://wiki.nimbyrails.com/Path_signal_setup |

## 1. La voie unique en France

| Fait | Valeur | Source | Confiance |
|---|---|---|---|
| Régime « Double voie » | 14 970 km, 53 % | D1 | 1 (calcul E) |
| Régime « Voie unique » (régime général) | 6 220 km, 22 % | D1 | 1 (calcul E) |
| Régime « Voie banalisée » | 3 340 km, 12 % ; surtout des lignes à une voie, mais le jeu de données y range aussi quelques doubles voies banalisées (LGV Atlantique 222 km) | D1 | 1 (calcul E) |
| Voie unique à trafic restreint (VUTR) | 2 290 km, 8 %, sans voyageurs | D1 ; S2 §3.3.3 | 1 (calcul E) |
| Voie unique à signalisation simplifiée (VUSS) | 1 050 km, 4 % | D1 | 1 (calcul E) |
| Navette et divers | 440 km, 1,5 % | D1 | 1 (calcul E) |
| **Total à une seule voie** | **environ 45 %** du kilométrage de lignes (47 % hors double voie, moins les doubles voies banalisées) | D1 | E |
| Petites lignes (catégories UIC 7 à 9) | 12 047 km sur 28 364 en 2017, soit 40 % ; 9 137 km portent des voyageurs | A1 | 1 |
| Part à voie unique des petites lignes | **78 %** ; 85 % non électrifiées | A1 (chiffre repris du rapport Philizot) | C (répété par plusieurs documents officiels, même origine) |
| Lignes à une voie avec cantonnement assisté par informatique | 1 765 km | site SNCF Réseau, vu en résumé de recherche | 1, non lu |

Réserves sur D1 : la somme des PK donne 28 300 km, cohérente avec les 28 000 km annoncés par SNCF Réseau ; le jeu de données peut contenir des lignes peu ou plus circulées, et il classe la plupart des LGV en « Double voie » alors qu'elles sont banalisées. Les pourcentages sont des ordres de grandeur.

Exemples de lignes à une voie avec TER (D1, noms de lignes ; le service TER actuel n'a pas été vérifié ligne par ligne) : Lyon – Grenoble – Marseille au sud de Grenoble (ligne des Alpes), Clermont-Ferrand – Nîmes (Cévennes), Béziers – Neussargues (Causses), Toulouse – Latour-de-Carol, Veynes – Briançon, Toulouse – Auch, Saint-Pierre-d'Albigny – Bourg-Saint-Maurice (Tarentaise), Dole – Vallorbe, Argentan – Granville, Lison – Lamballe, Nantes – Châteaubriant, Brive – Capdenac – Toulouse. En VUSS : Auray – Quiberon, Guingamp – Paimpol, Guingamp – Carhaix, Rennes – Châteaubriant, Bayonne – Saint-Jean-Pied-de-Port, Nice – Breil, Perpignan – Villefranche (D1, W9 ; C).

Ce qui nuance l'affirmation : la voie unique domine en kilomètres de petites lignes, mais la majorité des TER circulent sur les étoiles des grandes villes, à double voie (E, aucun chiffre trouvé en trains-kilomètres).

## 2. Régimes d'exploitation et signalisation d'une ligne à une voie

Point de vocabulaire : « voie unique » désigne en France un **régime d'exploitation**, pas le nombre de voies. Une ligne à une voie est soit en régime « voie unique » (sécurité par procédures humaines), soit en régime « voie banalisée » (sécurité par installations) (S2 §3.2, W6 ; C).

| Régime | Qui empêche le nez à nez | Espacement | Signaux sur le terrain | Sources | Confiance |
|---|---|---|---|---|---|
| Voie unique, régime général | les **horaires** (croisements obligatoires en gare, ordre de succession des trains à respecter absolument) et les agents des gares ; un train hors de son ordre ne s'engage qu'après procédure | cantonnement téléphonique, CAPI, CAPI 95 (avec arrêt automatique du train en cas d'erreur) ou BMVU | signaux **normalement fermés**, ouverts pour un train après procédure ; avant la gare, un disque ou un avertissement dont la fermeture impose l'arrêt en gare | S2 §3.3.1, §4.3 ; S1 art. 207, 213 | C |
| Voie unique avec BMVU | appareils de block reliés entre deux gares : un « test » vérifie que le sémaphore du sens opposé est fermé et bloqué et que la voie est libre | de gare à gare | sémaphores normalement fermés, **non permissifs**, à fermeture automatique ; le block s'interrompt à la traversée des gares | S2 §4.4.2 | 1 |
| VUSS | comme le régime général, plus l'**arrêt de tous les trains dans toutes les gares** ; aucune barrière technique | cantonnement téléphonique, CAPI si voyageurs | pas de signal de cantonnement : pancarte « GARE » à distance, puis repère d'entrée (chevron pointe en bas) ; signal d'arrêt à main sur le quai. 14 circulations par jour au plus, 18 sous conditions | S2 §3.3.2 ; W9 ; X6 | C |
| VUTR | consigne de ligne et « chef de ligne » ; aucun enclenchement | programme de circulation | normalement **aucun signal** ; 50 km/h au plus en général ; pas de voyageurs | S2 §3.3.3 | 1 |
| Navette | un seul train sur la section | sans objet | non étudié | S2 §3.3.4 | 1 |
| Voie banalisée à une voie | **enclenchement de sens** entre les deux extrémités de l'intervalle, automatique | block automatique (BAL ou BAPR), à circuits de voie ou compteurs d'essieux | signaux d'arrêt non permissifs aux deux extrémités de chaque intervalle ; cantons intermédiaires possibles, découpage identique dans les deux sens | S2 §3.3.5 ; W7 | C |

Ce que les sources disent de l'enclenchement de sens :

- L'**intervalle** est la portion entre deux points où un croisement ou un dépassement est possible. Ses deux extrémités portent des signaux d'arrêt non permissifs « permettant d'arrêter et de retenir les trains » (S2 §3.3.5 ; 1).
- L'enclenchement agit directement sur la commande des signaux de protection qui donnent accès à l'intervalle. Le carré d'accès ne s'ouvre que si « la totalité de la voie à parcourir est libre de tout engagement de train de sens contraire et demeurera libre ». L'interdiction du sens opposé est maintenue **tant que l'intervalle est occupé** (S2 §3.3.5 ; W7 ; C).
- Plusieurs trains de même sens peuvent se suivre dans un intervalle découpé en cantons : le block automatique les espace (S2 §3.3.5 ; 1).
- « BAPR de voie unique » : je n'ai pas trouvé ce terme comme régime réglementaire. Une ligne à une voie équipée de block automatique et d'un enclenchement de sens relève du régime « voie banalisée » ; « en block manuel, la ligne est qualifiée de voie unique » (W7 ; 1). X6 décrit pourtant La Pauline – Hyères comme VUSS « modernisée et équipée en BAPR » : contradiction non levée.

### Un signal par sens, jamais deux faces

| Fait | Source | Confiance |
|---|---|---|
| Un signal à demeure est implanté **à gauche de la voie à laquelle il s'adresse, ou au-dessus**. La règle vaut pour chaque sens : sur une voie banalisée, « quel que soit le sens, les signaux sont normalement implantés à gauche » | S1 art. 106 ; S2 §3.3.5 ; W7 | C |
| Conséquence : sur une voie parcourue dans les deux sens, les signaux d'un sens sont d'un côté de la voie, ceux de l'autre sens de l'autre côté, chacun tourné vers les trains qui arrivent. Ce sont des signaux distincts, avec leur propre plaque de repérage | déduit de la ligne précédente | E (déduction directe) |
| Sur une voie banalisée, le découpage en cantons est **identique dans les deux sens** : les limites de cantons coïncident, donc les deux signaux de sens opposés se trouvent à peu près au même endroit, de part et d'autre de la voie | S2 §3.3.5 (repris par O1) | 1 |
| Gare de croisement : les **panneaux de sortie** sont en bout des voies de dédoublement, un par voie et par sens. La règle « à gauche » y coûte cher : il faut des potences. Certaines gares de voie unique ou de voie banalisée ont donc des panneaux de sortie « implantés de part et d'autre des voies de dédoublement », certains à droite ; un repère bas (flèche verticale et ovale) le rappelle à l'entrée de la voie | S1 art. 106 ; W7 | C |
| Signal de groupe : un seul sémaphore mécanique peut commander la sortie des deux voies d'une « gare de voie directe » ; il est implanté côté voie directe et porte deux flèches blanches | S1 art. 106 | 1 |
| Exception de côté : signaux à droite en Alsace-Moselle et « sur certaines sections de ligne à voie unique désignées » aux documents de ligne | S1 art. 106, note 1 | 1 |
| Repère d'arrêt en gare de croisement : un chevron pointe en haut peut marquer le point à ne pas dépasser pour un train qui doit s'arrêter | S1 art. 608 | 1 |
| Vitesse : le ralentissement annoncé à l'entrée d'une gare de voie unique ou de voie banalisée vaut aussi pour l'**aiguille de sortie** | S1 art. 302 (Wikipédia, Signalisation ferroviaire en France) | C |

## 3. Double voie : IPCS et voie banalisée

| | IPCS (installations permanentes de contresens) | Double voie banalisée |
|---|---|---|
| Idée | chaque voie garde un sens normal ; l'autre sens est possible à tout moment, sans arrêt ni avis préalable autre que la signalisation | aucune voie n'a de sens privilégié ; conditions quasi identiques dans les deux sens |
| Usage | travaux, incident, dépassement d'un train lent | exploitation courante |
| Nez à nez | enclenchements entre postes encadrants | enclenchement de sens par intervalle |
| Côté des signaux de l'autre sens | **à droite**, sans flèche blanche, répétés en cabine | **à gauche** dans chaque sens (potences) |
| Signaux propres | tableau lumineux d'entrée à contresens (TECS), normalement éteint, groupé avec le carré qui protège l'aiguille d'entrée ; tableau de sortie de contresens (TSCS), groupé avec le carré qui protège l'aiguille de sortie | aucun tableau particulier |
| Cantons de l'autre sens | un ou plusieurs ; cantons de BAL ou longs cantons à block absolu | les mêmes que dans l'autre sens |
| Vitesse | « fréquemment plus faible qu'en sens normal » (exemple d'entrée à 60 km/h dans S2) | identique ; changements de voie à 60 ou 90 km/h |
| Exemples | Maurienne, Givors – Saint-Étienne, Creil – Longueau, Mantes – Vernon ; premières en 1972 | Dijon – Blaisy-Bas (1950), Les Laumes – Tonnerre, Houilles – Sartrouville (1933) |
| Sources | S2 §3.4.1 ; S1 art. 106 ; W8 | W7 ; S2 §3.3.5 |
| Confiance | C | C (exemples : 1) |

Les autres cas de double voie parcourue à l'envers (voie unique temporaire, mouvement à contre-voie) reposent sur des procédures et ne concernent pas un simulateur à ce stade (S2 §3.4 ; 1).

## 4. LGV

| Fait | Source | Confiance |
|---|---|---|
| Toutes les LGV sont exploitées en voie banalisée, avec des points de changement de voie répartis le long de la ligne ; elles n'ont pas d'IPCS. Le surcoût est faible puisqu'il n'y a presque pas de signaux au sol | W7 (phrase marquée « référence nécessaire ») ; Rétiveau §19.2 cité dans `recherche-signalisation.md` | C |
| En signalisation de cabine, l'espacement dans les deux sens est assuré par la TVM ou l'ETCS | S2 §3.3.5 | 1 |
| Les limites de cantons sont matérialisées par des repères (triangle jaune sur fond bleu, la pointe désigne la voie concernée) ; le repère Nf marque un canton non permissif | W4 ; `recherche-signalisation.md` §6 | C |
| Les repères Nf et repères de manœuvre peuvent porter, en plus de leur plaque, une plaque d'identification arrière lisible par un conducteur venant de l'autre sens | résumé de recherche attribué au référentiel TVM, non retrouvé dans le texte lu | 1, non vérifié |
| Transmission ponctuelle : en TVM 300 l'émetteur n'est pas directionnel et l'information dépend du sens établi sur la voie ; en TVM 430 les boucles sont bidirectionnelles, le même message porte les informations des deux sens | W4 | 1 |
| Le conducteur arme la signalisation de cabine pour la **voie** où il se trouve (voie 1 ou voie 2), « quel que soit le sens de circulation » | RFN-IG-SE 01 A-00 n° 013, art. 205 | 1 |
| Le sens d'une voie de LGV est une donnée du poste : la séquence des vitesses transmise en cabine est calculée pour le sens établi. Il y a donc un jeu de repères par sens, mais aucun feu à orienter | déduit des lignes précédentes | E |

## 5. Dans les jeux (rappel)

`recherche-signalisation-niveaux.md` relève deux modèles incompatibles : **un objet à deux faces** (OpenTTD pour le signal de bloc, Mashinky, où c'est le défaut) et **deux objets dos à dos** (Factorio, où le sens vient du côté de pose). Problèmes constatés sur voie unique : nez à nez avec les signaux à double sens (Mashinky, qui en fait la première cause), blocage en gare faute de signaux aux deux bouts de l'évitement (Transport Fever 2), voie unique à double sens sans signaux chaînés (Factorio).

À ajouter : dans OpenTTD, **le signal de chemin n'a toujours qu'un sens** ; seul l'ancien signal de bloc peut être à double sens (J1 ; 1).

## 6. Règle minimale contre le nez à nez

| Logiciel | Règle | Ce que le joueur doit faire | Source | Confiance |
|---|---|---|---|---|
| OpenTTD, signal de chemin | rouge par défaut ; le train réserve son chemin jusqu'à la prochaine **position d'attente sûre** (devant un signal, un dépôt, une fin de voie). Le dos d'un signal de chemin n'est pas une position sûre, donc la réservation traverse toute la voie unique jusqu'au signal qui fait face au train | un signal de chemin à chaque sortie d'évitement, tourné vers le train qui part ; **aucun signal dans la voie unique** | J1 | 1 (règle) ; E (application à l'évitement) |
| Simutrans, signal de long block | un signal normal ne vérifie que jusqu'à la prochaine gare, d'où deux trains de sens opposés bloqués dans deux gares d'une même voie unique. Le signal de long block vérifie **jusqu'au signal suivant, gares comprises**, puis réserve jusqu'à la gare ; le train d'en face voit la réservation et n'entre pas | un signal de long block sur **toutes** les voies qui mènent au goulet ; aucun autre signal dans le goulet | J6 | 1 |
| NIMBY Rails, signal de chemin | une voie unique sans évitement n'admet qu'un train. Avec des gares intermédiaires, le signal d'accès doit être d'un type qui **regarde au-delà de la prochaine gare** ; la recherche s'arrête aux signaux du sens opposé | signaux de chemin « longs » à toutes les entrées de la section à voie unique ; évitements en pleine voie ou en gare | J10 | 1 (les codes de types DS, AS du wiki n'ont pas été décodés) |
| Rail Route | rien trouvé de spécifique à la voie unique : l'itinéraire tracé par le joueur ou par un capteur verrouille les tronçons jusqu'au signal de destination | — | J4 de `recherche-signalisation.md` | non trouvé |
| Transport Fever 3 | la réservation peut dépasser un arrêt sans rebroussement, pour ne pas laisser entrer deux trains de sens opposés dans une voie unique à plusieurs arrêts | — | résumé de recherche | 1, non lu |

Les trois jeux lus convergent avec la règle française : **la réservation s'étend d'un point de croisement au suivant, pas d'un arrêt au suivant**, et **il n'y a pas de signal d'arrêt au milieu de la section** sauf s'il est couvert par un sens établi.

Formulation pour un moteur à réservation (E) :

1. **Intervalle** : ensemble des tronçons parcourables dans les deux sens compris entre deux points où un train peut en laisser passer un autre. Il se calcule sur le graphe, comme les sections.
2. Un intervalle a un état : libre, pris dans le sens A, pris dans le sens B.
3. Le signal qui donne accès à un intervalle ne s'ouvre que si l'intervalle est libre ou déjà pris dans le même sens, et si le premier canton est libre. L'ouverture prend le sens.
4. Le sens est rendu quand le dernier train engagé a dégagé l'intervalle, queue comprise.
5. Avant d'ouvrir, vérifier que le train a une place à l'arrivée : une voie libre de l'évitement suivant, ou la voie unique au-delà. Sans cela deux trains se retrouvent face à face à l'évitement, chacun bloquant la sortie de l'autre.
6. Le signal d'accès est un signal de protection, non franchissable fermé.

## Conclusion pour le simulateur

**(a) L'affirmation est-elle exacte ?** Oui sur le fond, avec une nuance. Environ 45 % du kilométrage du réseau national n'a qu'une voie, et 78 % des petites lignes, où circulent surtout des TER. Les lignes de montagne et de campagne desservies par TER sont en grande majorité à voie unique. En revanche la majorité des TER, comptés en trains, roulent sur les doubles voies autour des grandes villes (estimation, pas de chiffre trouvé). Le terme exact est « ligne à une voie » : « voie unique » désigne en France un régime d'exploitation fondé sur des procédures, et une ligne à une voie bien équipée est dite « voie banalisée ». Le besoin de signaler une voie dans les deux sens est donc réel et courant.

**(b) Un signal à deux faces, ou deux signaux ?** Deux signaux. Le signal à deux faces n'existe pas en France : chaque signal s'adresse à un sens, fait face aux trains qui arrivent et se trouve à gauche de la voie dans ce sens. Sur une voie parcourue dans les deux sens, les deux signaux sont donc de part et d'autre de la voie, à peu près au même point kilométrique en pleine voie banalisée (le découpage en cantons est le même dans les deux sens). À retenir pour le modèle :

- l'objet « signal » reste **à un seul sens** (position sur la voie + sens), ce que prévoit déjà `recherche-signalisation.md` ;
- « double sens » est une **commande de pose** qui crée deux signaux dos à dos, chacun dessiné à gauche de son sens, et non une propriété du signal ; c'est aussi le choix déjà retenu dans `recherche-signalisation-niveaux.md` ;
- chaque signal a ensuite sa vie propre (indication, type, suppression), car les deux sens n'ont pas le même état à un instant donné ;
- en gare de croisement, les deux signaux d'un même bout ne sont pas au même endroit : le signal d'entrée est avant l'aiguille, côté voie unique ; les signaux de sortie sont au bout de chaque voie de l'évitement, avant l'aiguille.

**(c) Règle de sécurité minimale.** Un train n'entre dans une section à une voie que si **toute la section jusqu'au prochain point de croisement** est libre de train de sens contraire, et la section reste interdite à l'autre sens tant qu'elle est occupée. Concrètement : calculer les intervalles sur le graphe, leur donner un état de sens (libre, sens A, sens B), faire dépendre de cet état l'ouverture des signaux d'accès, qui sont des signaux de protection non franchissables. Ajouter la vérification qu'une voie est libre à l'évitement d'arrivée. Aucun signal d'arrêt en pleine voie unique n'est nécessaire ; s'il y en a (cantons intermédiaires), ils vont par paires et ne servent qu'à espacer des trains de même sens. C'est la règle réelle (enclenchement de sens) et c'est aussi ce que font OpenTTD, Simutrans et NIMBY Rails.

**(d) Ce qu'il faut montrer à un débutant.** Un seul schéma, celui de l'évitement, avec six signaux. Les signaux du sens → sont dessinés au-dessus de la voie (à gauche de ce sens), ceux du sens ← au-dessous.

```
 sens →  : signaux au-dessus          sens ←  : signaux au-dessous

            [E→]                                    [S2→]
                        ┌─────────── voie 2 ───────────┐
                        │ [S2←]                 [S1→]  │
 ═══ voie unique A ═════╧═══════════ voie 1 ═══════════╧═════ voie unique B ═══
                          [S1←]                                 [E←]

 E  = signal d'entrée de l'évitement, sur la voie unique, avant l'aiguille
 S1, S2 = signaux de sortie, un au bout de chaque voie, avant l'aiguille
```

Les quatre règles à afficher avec :

1. **Au bout de chaque voie de l'évitement, un signal de sortie** tourné vers le train qui va partir. C'est lui qui retient le train tant que la voie unique devant n'est pas libre.
2. **Avant chaque aiguille d'entrée, un signal d'entrée** sur la voie unique. Il retient le train tant qu'aucune voie de l'évitement n'est libre.
3. **Rien entre deux évitements.** Un signal posé au milieu de la voie unique permet à deux trains de s'y arrêter face à face.
4. **L'évitement est plus long que le plus long train**, sinon la queue du train reste sur l'aiguille.

Aides utiles, par ordre de rendement (E) : un outil « évitement signalé » qui pose les six signaux d'un coup (le simulateur a déjà la voie d'évitement comme gabarit de construction) ; la coloration de l'intervalle quand il est pris, avec une flèche de sens ; trois avertissements non bloquants : sortie d'évitement sans signal, signal de block franchissable à l'entrée d'une section à une voie, signal isolé en pleine voie unique sans son vis-à-vis.

## Non trouvé ou contradictoire

| Sujet | État |
|---|---|
| Part des TER circulant sur ligne à une voie, en trains ou en trains-kilomètres | non trouvé ; seule la part en kilomètres de lignes est chiffrée |
| Kilométrage officiel de lignes à une voie publié par SNCF Réseau ou l'ART | non trouvé ; le chiffre de 45 % est mon calcul sur D1, à 2 ou 3 points près |
| « BAPR de voie unique » comme régime | terme non trouvé dans S1, S2 ; W7 range le block automatique à une voie sous « voie banalisée », X6 parle d'une VUSS équipée en BAPR |
| Schéma coté d'une gare de croisement en voie banalisée (distance du signal d'entrée à l'aiguille, position exacte des panneaux de sortie) | non trouvé ; seules les règles générales de `recherche-signalisation.md` §5 s'appliquent (carré à 100 m au moins du garage franc) |
| Nombre et position réels des signaux intermédiaires sur une voie banalisée à une voie en BAL | seulement la règle « découpage identique dans les deux sens » (une source) |
| Vitesse à contresens en IPCS | « fréquemment plus faible », un exemple à 60 km/h pour l'entrée ; pas de règle générale chiffrée |
| Plaque arrière des repères Nf sur LGV | vue en résumé de recherche, pas dans le texte du référentiel que j'ai lu |
| Rail Route sur voie unique | rien de spécifique trouvé |
| Sections de voie unique où les signaux sont à droite | l'existence est attestée (S1 art. 106), la liste ne l'est pas |
| Rétiveau (S3) sur l'enclenchement de sens et les gares de voie unique | non relu pour ce rapport ; ce serait la source à consulter pour un schéma d'enclenchement détaillé |
