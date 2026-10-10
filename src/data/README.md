# Données embarquées

## `stations-fr.json` — gares de voyageurs de France

Source : SNCF Gares & Connexions, jeu de données « Gares de voyageurs »
(https://ressources.data.sncf.com/explore/dataset/gares-de-voyageurs/), sous licence
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). La date des données est dans le fichier.

Une ligne par gare : `[nom, trigramme, codesUIC, lat, lon, segment]`. Les codes UIC ont huit
chiffres, le dernier étant une clé ; OpenStreetMap écrit les sept premiers (`uic_ref`). Le segment
est la classe DRG : A nationale, B régionale, C locale.

Régénérer : `node tools/stations/fetch-sncf-stations.mjs`.

L'application le charge à la demande (fenêtre d'import OpenStreetMap) pour donner aux gares
importées leur nom officiel et leur trigramme, et plus tard pour chercher une gare.
