/** A box of the map, degrees */
export interface Tile {
  south: number
  west: number
  north: number
  east: number
}

const round = (v: number): number => Math.round(v * 1e6) / 1e6

/** The tiles of `deg` degrees that cover a box, row by row from the south-west; the last ones are clipped to the box */
export function tilesOf(bbox: [number, number, number, number], deg: number): Tile[] {
  const [south, west, north, east] = bbox
  const tiles: Tile[] = []
  for (let lat = south; lat < north; lat = round(lat + deg)) {
    for (let lon = west; lon < east; lon = round(lon + deg)) {
      tiles.push({ south: lat, west: lon, north: round(Math.min(lat + deg, north)), east: round(Math.min(lon + deg, east)) })
    }
  }
  return tiles
}

/** The four quarters of a tile, for an answer too large to come whole */
export function splitTile(tile: Tile): Tile[] {
  const midLat = round((tile.south + tile.north) / 2)
  const midLon = round((tile.west + tile.east) / 2)
  return [
    { south: tile.south, west: tile.west, north: midLat, east: midLon },
    { south: tile.south, west: midLon, north: midLat, east: tile.east },
    { south: midLat, west: tile.west, north: tile.north, east: midLon },
    { south: midLat, west: midLon, north: tile.north, east: tile.east },
  ]
}

/** A name for a tile that reads in a directory */
export function tileKey(tile: Tile): string {
  const d = (v: number): string => String(v).replace('-', 'm').replace('.', '_')
  return `tile_${d(tile.south)}_${d(tile.west)}_${d(tile.north)}_${d(tile.east)}`
}
