#!/usr/bin/env python3
"""
Turn the railway tracks OpenStreetMap holds around a point into an Open Rails project file.

    python tools/osm-import/osm_to_project.py --lat 43.3030 --lon 5.3815 --dist 1100 \
        --name "Marseille Saint-Charles (OSM)" -o src/examples/marseille-saint-charles.json

Needs `osmnx` (pip install osmnx). The data is © OpenStreetMap contributors, under the ODbL: a
project made with this script must say so wherever it is published.

What comes out is a `SerializedProject` (see src/infrastructure/persistence/persistence.ts) at the
real scale: world metres, x to the east, y to the south, the given point at the origin.

- Only `railway=rail` is read (no metro, no tram), and only the largest connected piece.
- A run of OSM nodes between two turnouts becomes a chain of rails that meet tangent to each other:
  straight where the track is, a quadratic Bézier elsewhere.
- No route table is written. The editor reads each fork from the geometry when the file is opened
  (`proposeJunction`): a turnout needs its two branches within 15° of the stem, a double slip needs
  its four rails tangent at the node — which is how the nodes OSM tags `switch` with four tracks are
  laid here. Two tracks that merely cross keep their own directions and make a fixed crossing.
- `maxspeed` becomes speed zones. Signals, platforms and heights are not read.
"""

import argparse
import collections
import json
import math
import os
import sys
import tempfile

import networkx as nx
import osmnx as ox

# Two OSM nodes closer than this (m) on one track are made one
MIN_RAIL_LENGTH = 10.0
# Around a double slip the rails are bent onto its line: no node is kept closer than this (m)
SLIP_CLEARANCE = 30.0
# Below this angle (degrees) between a rail's chord and its end directions, the rail is straight
STRAIGHT_TOLERANCE_DEG = 0.15
# A rail whose end directions do not make one arc is still laid straight when they are this close
# (degrees) to its chord: the kink left at its ends cannot be seen
KINK_TOLERANCE_DEG = 0.6
# One arc is laid between two nodes when the angles at its ends are within this ratio of each other
MAX_ARC_IMBALANCE = 8.0
# An OSM stretch this long (m), and this many times longer than its neighbour, is a straight line:
# the track is tangent to it where it ends
LONG_STRETCH = 30.0
LONG_STRETCH_RATIO = 3.0
# Widest angle (degrees) between a rail and the one that continues it through a turnout
# (MAX_TRANSITION_DEFLECTION_DEG in src/domain/geometry/tangent.ts)
MAX_DEFLECTION_DEG = 15.0
# Speed zones are multiples of this (km/h), see src/domain/models/speedZones.ts
ZONE_STEP = 10


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def unit(v):
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n)


def signed_angle(a, b):
    """Angle in radians from direction `a` to direction `b`, in -π…π"""
    return math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])


def deflection_deg(leave_a, leave_b):
    """0 when two rails leaving a node in directions `leave_a` and `leave_b` run straight through"""
    return 180.0 - abs(math.degrees(signed_angle(leave_a, leave_b)))


def download(lat, lon, dist):
    # Keep the answers of the OSM server out of the repository
    ox.settings.cache_folder = os.path.join(tempfile.gettempdir(), "osmnx-cache")
    ox.settings.useful_tags_way = ["railway", "service", "usage", "maxspeed"]
    ox.settings.useful_tags_node = ["railway"]
    graph = ox.graph_from_point(
        (lat, lon), dist=dist, custom_filter='["railway"="rail"]', simplify=False, retain_all=True, truncate_by_edge=True
    )
    # Azimuthal projection centred on the point: metres, north up, no distortion at this size
    graph = ox.project_graph(graph, to_crs=f"+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m")
    tracks = nx.Graph(graph)
    return tracks.subgraph(max(nx.connected_components(tracks), key=len)).copy()


def zone_speed(raw):
    """The speed zone (km/h) of a `maxspeed` tag, None when there is none to read"""
    if isinstance(raw, list):
        raw = raw[0]
    try:
        speed = float(str(raw).split()[0])
    except (TypeError, ValueError, IndexError):
        return None
    speed = int(round(speed / ZONE_STEP) * ZONE_STEP)
    return speed if speed >= ZONE_STEP else None


class Converter:
    def __init__(self, tracks):
        self.tracks = tracks
        # y to the south: the canvas draws y downwards
        self.pos = {n: (d["x"], -d["y"]) for n, d in tracks.nodes(data=True)}
        self.counter = 0
        self.node_ids = {}
        self.nodes = []
        self.segments = []
        self.zones = []
        self.slips = self.find_double_slips()
        self.report = collections.Counter()

    def next_id(self, prefix):
        self.counter += 1
        return f"{prefix}_{self.counter}"

    def add_node(self, point, osm_id=None):
        if osm_id is not None and osm_id in self.node_ids:
            return self.node_ids[osm_id]
        node_id = self.next_id("n")
        self.nodes.append({"id": node_id, "x": round(point[0], 3), "y": round(point[1], 3)})
        if osm_id is not None:
            self.node_ids[osm_id] = node_id
        return node_id

    def leave(self, node, neighbour):
        return unit(sub(self.pos[neighbour], self.pos[node]))

    def find_double_slips(self):
        """
        For each node tagged `switch` where four tracks meet two against two: the direction of the
        line they share there. Their rails are laid tangent to it, which is what makes a double slip.
        """
        slips = {}
        for node, data in self.tracks.nodes(data=True):
            neighbours = list(self.tracks[node])
            if data.get("railway") != "switch" or len(neighbours) != 4:
                continue
            rays = [self.leave(node, n) for n in neighbours]
            mates = [k for k in (1, 2, 3) if rays[0][0] * rays[k][0] + rays[0][1] * rays[k][1] > 0]
            if len(mates) != 1:
                continue
            side = [0, mates[0]]
            other = [k for k in (1, 2, 3) if k != mates[0]]
            if not all(deflection_deg(rays[i], rays[k]) <= MAX_DEFLECTION_DEG for i in side for k in other):
                continue
            axis = unit((
                rays[side[0]][0] + rays[side[1]][0] - rays[other[0]][0] - rays[other[1]][0],
                rays[side[0]][1] + rays[side[1]][1] - rays[other[0]][1] - rays[other[1]][1],
            ))
            slips[node] = axis
        return slips

    def chains(self):
        """Every run of OSM nodes from one node that is not a plain joint to the next"""
        ends = {n for n in self.tracks if self.tracks.degree(n) != 2}
        seen = set()
        for start in ends:
            for first in self.tracks[start]:
                if (start, first) in seen:
                    continue
                chain = [start, first]
                while chain[-1] not in ends:
                    a, b = self.tracks[chain[-1]]
                    chain.append(b if a == chain[-2] else a)
                seen.add((chain[0], chain[1]))
                seen.add((chain[-1], chain[-2]))
                yield chain
        # A closed loop with no turnout on it is not met from any end; none exists around a station

    def thin(self, chain):
        """
        The chain without the nodes that stand too close to the one kept before them, or to its
        ends: OSM nodes are a few decimetres off, which over a short rail is a sharp bend.
        """
        def clearance(end):
            return SLIP_CLEARANCE if end in self.slips else MIN_RAIL_LENGTH

        first, last = self.pos[chain[0]], self.pos[chain[-1]]
        kept = [chain[0]]
        for node in chain[1:-1]:
            point = self.pos[node]
            if math.dist(point, first) < clearance(chain[0]) or math.dist(point, last) < clearance(chain[-1]):
                continue
            if math.dist(point, self.pos[kept[-1]]) >= MIN_RAIL_LENGTH:
                kept.append(node)
        kept.append(chain[-1])

        return kept

    def tangents(self, chain):
        """Direction of travel of the track at each node of the chain"""
        pts = [self.pos[n] for n in chain]
        last = len(pts) - 1
        result = [None] * len(pts)
        for i in range(1, last):
            before = sub(pts[i], pts[i - 1])
            after = sub(pts[i + 1], pts[i])
            l_before, l_after = math.hypot(*before), math.hypot(*after)
            if l_before >= LONG_STRETCH and l_before >= LONG_STRETCH_RATIO * l_after:
                result[i] = unit(before)
            elif l_after >= LONG_STRETCH and l_after >= LONG_STRETCH_RATIO * l_before:
                result[i] = unit(after)
            else:
                # Tangent of the circle through the three nodes
                u_before, u_after = unit(before), unit(after)
                result[i] = unit((u_before[0] * l_after + u_after[0] * l_before, u_before[1] * l_after + u_after[1] * l_before))

        # At an end the track leaves as the arc that reaches the next node would: its direction there
        # mirrored in the chord. A double slip imposes its own line instead.
        def travel_chord(i, neighbour):
            return unit(sub(pts[neighbour], pts[i]) if neighbour > i else sub(pts[i], pts[neighbour]))

        def slip_tangent(i, neighbour):
            axis = self.slips.get(chain[i])
            if axis is None:
                return None
            chord = travel_chord(i, neighbour)
            return axis if axis[0] * chord[0] + axis[1] * chord[1] > 0 else (-axis[0], -axis[1])

        def mirrored(direction, chord):
            dot = direction[0] * chord[0] + direction[1] * chord[1]
            return unit((2 * dot * chord[0] - direction[0], 2 * dot * chord[1] - direction[1]))

        def arc_tangent(i, neighbour):
            chord = travel_chord(i, neighbour)
            return chord if result[neighbour] is None else mirrored(result[neighbour], chord)

        def arc_tangent_from(i, neighbour):
            return mirrored(result[i], travel_chord(i, neighbour))

        ends = ((0, 1), (last, last - 1))
        for i, neighbour in ends:
            result[i] = slip_tangent(i, neighbour)
            if result[i] is not None and 0 < neighbour < last:
                # One arc out of the double slip: it settles the direction at the node it reaches
                result[neighbour] = None
                result[neighbour] = arc_tangent_from(i, neighbour)
        for i, neighbour in ends:
            if result[i] is None:
                result[i] = arc_tangent(i, neighbour)
        return result

    def add_rail(self, from_id, to_id, via=None):
        seg = {"id": self.next_id("s"), "from": from_id, "to": to_id, "kind": "straight" if via is None else "curve"}
        if via is not None:
            seg["via"] = {"x": round(via[0], 3), "y": round(via[1], 3)}
        self.segments.append(seg)
        return seg["id"]

    def lay(self, p0, t0, id0, p1, t1, id1):
        """Rails from p0 to p1 that leave along t0 and arrive along t1. Returns their ids in order."""
        chord = sub(p1, p0)
        length = math.hypot(*chord)
        d0 = signed_angle(chord, t0)
        d1 = signed_angle(chord, t1)
        low, high = sorted((abs(d0), abs(d1)))
        one_arc = d0 * d1 < 0 and low > math.radians(STRAIGHT_TOLERANCE_DEG) and high < MAX_ARC_IMBALANCE * low
        if high < math.radians(STRAIGHT_TOLERANCE_DEG) or (not one_arc and high < math.radians(KINK_TOLERANCE_DEG)):
            self.report["straight"] += 1
            return [self.add_rail(id0, id1)]

        if one_arc:
            # One arc: its control point is where the two end tangents meet
            reach = length * math.sin(abs(d1)) / math.sin(abs(d0) + abs(d1))
            self.report["curve"] += 1
            return [self.add_rail(id0, id1, (p0[0] + t0[0] * reach, p0[1] + t0[1] * reach))]

        # The end directions do not make one arc (an S, or a straight end): two arcs meeting tangent
        # halfway, each with its control point on the tangent of its end
        reach = length / 4
        q0 = (p0[0] + t0[0] * reach, p0[1] + t0[1] * reach)
        q1 = (p1[0] - t1[0] * reach, p1[1] - t1[1] * reach)
        middle = self.add_node(((q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2))
        self.report["curve"] += 2
        return [self.add_rail(id0, middle, q0), self.add_rail(middle, id1, q1)]

    def untangle(self, laid):
        """
        Two rails leaving a node on the same side must leave it in the order they lie further on,
        or they would cross each other just past the node. Where the arcs chosen do not, both rails
        leave along the straight line to their next node instead.
        """
        leaving = collections.defaultdict(list)
        for kept, tangents in laid:
            last = len(kept) - 1
            leaving[kept[0]].append((tangents, 0, self.leave(kept[0], kept[1]), 1))
            leaving[kept[last]].append((tangents, last, self.leave(kept[last], kept[last - 1]), -1))
        for node, rails in leaving.items():
            if len(rails) < 3 or node in self.slips:
                continue
            for i, (tangents_a, at_a, chord_a, way_a) in enumerate(rails):
                for tangents_b, at_b, chord_b, way_b in rails[i + 1:]:
                    if chord_a[0] * chord_b[0] + chord_a[1] * chord_b[1] <= 0:
                        continue
                    leave_a = (tangents_a[at_a][0] * way_a, tangents_a[at_a][1] * way_a)
                    leave_b = (tangents_b[at_b][0] * way_b, tangents_b[at_b][1] * way_b)
                    if signed_angle(chord_a, chord_b) * signed_angle(leave_a, leave_b) < 0:
                        tangents_a[at_a] = (chord_a[0] * way_a, chord_a[1] * way_a)
                        tangents_b[at_b] = (chord_b[0] * way_b, chord_b[1] * way_b)
                        self.report["untangled"] += 1

    def convert_chain(self, chain, kept, tangents):
        speeds = [zone_speed(self.tracks.edges[a, b].get("maxspeed")) for a, b in zip(chain, chain[1:])]
        index = {node: i for i, node in enumerate(chain)}

        run_speed, run = None, []
        for i in range(len(kept) - 1):
            a, b = kept[i], kept[i + 1]
            rails = self.lay(
                self.pos[a], tangents[i], self.add_node(self.pos[a], a),
                self.pos[b], tangents[i + 1], self.add_node(self.pos[b], b),
            )
            speed = speeds[index[a]]
            if speed != run_speed:
                self.add_zone(run_speed, run)
                run_speed, run = speed, []
            run.extend(rails)
        self.add_zone(run_speed, run)

    def add_zone(self, speed, rails):
        if speed is None or not rails:
            return
        self.zones.append({"id": None, "speed": speed, "spans": [{"segId": sid, "t0": 0, "t1": 1} for sid in rails]})

    def check_turnouts(self):
        """Count the nodes by what the editor will read there, from the directions the rails leave in"""
        leaves = collections.defaultdict(list)
        by_id = {n["id"]: (n["x"], n["y"]) for n in self.nodes}
        for seg in self.segments:
            for end, far in ((seg["from"], seg["to"]), (seg["to"], seg["from"])):
                toward = (seg["via"]["x"], seg["via"]["y"]) if "via" in seg else by_id[far]
                leaves[end].append(unit(sub(toward, by_id[end])))
        kinds = collections.Counter()
        for node, rays in leaves.items():
            if len(rays) < 3:
                continue
            continued = [sum(1 for k, other in enumerate(rays) if k != i and deflection_deg(ray, other) <= MAX_DEFLECTION_DEG) for i, ray in enumerate(rays)]
            stems = sum(1 for c in continued if c >= 2)
            if stems == 1:
                kinds["aiguillages"] += 1
            elif stems == 4 and len(rays) == 4:
                tangent = min(
                    abs(math.degrees(signed_angle(a, b))) for i, a in enumerate(rays) for b in rays[i + 1:]
                ) < 1
                kinds["traversées-jonctions" if tangent else "traversées"] += 1
            elif stems == 0 and len(rays) == 4:
                kinds["traversées"] += 1
            else:
                kinds["nœuds non reconnus"] += 1
                print(f"  non reconnu : {node} ({len(rays)} rails, {stems} pointes) en {by_id[node]}", file=sys.stderr)
        return kinds

    def project(self, name):
        chains = list(self.chains())
        laid = []
        for chain in chains:
            kept = self.thin(chain)
            laid.append((kept, self.tangents(kept)))
        self.untangle(laid)
        for chain, (kept, tangents) in zip(chains, laid):
            self.convert_chain(chain, kept, tangents)
        for zone in self.zones:
            zone["id"] = self.next_id("z")
        speeds = [zone["speed"] for zone in self.zones]
        project = {
            "version": 2,
            "name": name,
            "nodes": self.nodes,
            "segments": self.segments,
            "unit": "m",
            "scalePreset": "1:1",
            "gauge": 1.435,
            "trackSpacing": 3.8,
            "showDimensions": False,
            "boardEnabled": False,
        }
        if speeds:
            project["speedZones"] = self.zones
            # The ceiling of the line is the fastest track read; untagged tracks run at it
            project["lineSpeed"] = max(speeds)
        return project


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--lat", type=float, required=True)
    parser.add_argument("--lon", type=float, required=True)
    parser.add_argument("--dist", type=float, default=1000, help="half side of the square read, in metres")
    parser.add_argument("--name", required=True, help="name of the project")
    parser.add_argument("-o", "--output", required=True)
    args = parser.parse_args()

    converter = Converter(download(args.lat, args.lon, args.dist))
    project = converter.project(args.name)
    with open(args.output, "w", encoding="utf-8") as out:
        json.dump(project, out, ensure_ascii=False, separators=(",", ":"))
        out.write("\n")

    print(f"{args.output} : {len(project['nodes'])} nœuds, {len(project['segments'])} rails "
          f"({converter.report['straight']} droits, {converter.report['curve']} courbes), "
          f"{len(project.get('speedZones', []))} zones de vitesse, {converter.report['untangled']} départs redressés")
    for kind, count in sorted(converter.check_turnouts().items()):
        print(f"  {count} {kind}")


if __name__ == "__main__":
    main()
