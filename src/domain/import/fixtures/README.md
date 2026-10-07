# Fixtures of the OpenStreetMap import

Railway tracks of four areas, as an Overpass server answered them on 2026-10-06, trimmed for the
tests of `src/domain/import/`.

Data © OpenStreetMap contributors, available under the Open Database License (ODbL) 1.0 —
https://www.openstreetmap.org/copyright

| File | Area | Bounding box (south, west, north, east) | Data date (`timestamp_osm_base`) |
|---|---|---|---|
| `dijon-ville.json` | Dijon-Ville station and its junctions | `47.305,5.000,47.335,5.045` | 2026-10-06T07:14:21Z |
| `clelles-mens.json` | Single track of the ligne des Alpes at Clelles-Mens | `44.790,5.590,44.860,5.670` | 2026-10-06T07:27:36Z |
| `lgv-pasilly.json` | LGV Sud-Est, junction of Pasilly | `47.660,4.020,47.750,4.150` | 2026-10-06T07:26:35Z |
| `paris-gare-de-lyon.json` | Paris Gare de Lyon, Bercy, down to Charenton | `48.815,2.365,48.850,2.425` | 2026-10-06T07:18:23Z |

Query (the box replaced for each area):

```
[out:json][timeout:90][bbox:48.815,2.365,48.850,2.425];
(way[railway];node[railway];)->.a;
.a out body;
way.a;>;out skel qt;
way.a;rel(bw)[type=route][route~"^(tracks|railway)$"];out tags;
```

What was kept of each answer:

- the ways whose `railway` is `rail`, `light_rail`, `subway`, `tram`, `narrow_gauge`, `disused` or
  `abandoned` (Paris: `rail` and `subway` only), with the tags `railway`, `service`, `usage`,
  `layer`, `bridge`, `tunnel`, `maxspeed`, `maxspeed:forward`, `maxspeed:backward`, `highspeed`,
  `railway:tvm`, `area`;
- the nodes of those ways, each once (the answers list every tagged node twice, once with its tags
  and once bare), with the tags `railway`, `railway:switch`, `railway:signal:direction`,
  `railway:signal:main`, `railway:signal:position`, `ref` when the node has a `railway` tag; and,
  on the `railway=signal` nodes, what the import of the signals reads: the key of each category
  (`railway:signal:distant`, `:speed_limit`, `:shunting`…), `railway:signal:main:plate`, `:type`,
  `:states`, `:function`, `:deactivated`, and every `railway:signal:train_protection:*` key (added
  from the same answers, « the version with tags wins », without touching anything else);
- `osm3s.timestamp_osm_base`.

Everything else — relations, platforms, buildings of the railway, the other tags — was dropped, and
the files are written on one line.
