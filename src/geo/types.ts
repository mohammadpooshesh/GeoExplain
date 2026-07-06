// GeoJSON-compatible planar geometry model + traversal helpers.

export type Pt = [number, number]

export type PointG = { type: "Point"; coordinates: Pt }
export type MultiPointG = { type: "MultiPoint"; coordinates: Pt[] }
export type LineStringG = { type: "LineString"; coordinates: Pt[] }
export type MultiLineStringG = { type: "MultiLineString"; coordinates: Pt[][] }
export type PolygonG = { type: "Polygon"; coordinates: Pt[][] }
export type MultiPolygonG = { type: "MultiPolygon"; coordinates: Pt[][][] }
export type GeometryCollectionG = {
  type: "GeometryCollection"
  geometries: Geom[]
}

export type Geom =
  | PointG
  | MultiPointG
  | LineStringG
  | MultiLineStringG
  | PolygonG
  | MultiPolygonG
  | GeometryCollectionG

export function cloneGeom<T extends Geom>(g: T): T {
  return JSON.parse(JSON.stringify(g)) as T
}

/** Every coordinate of the geometry (rings unclosed). */
export function verticesOf(g: Geom): Pt[] {
  switch (g.type) {
    case "Point":
      return [g.coordinates]
    case "MultiPoint":
      return g.coordinates.slice()
    case "LineString":
      return g.coordinates.slice()
    case "MultiLineString":
      return g.coordinates.flat()
    case "Polygon":
      return g.coordinates.flat()
    case "MultiPolygon":
      return g.coordinates.flat(2)
    case "GeometryCollection":
      return g.geometries.flatMap((x) => verticesOf(x))
  }
}

/** Open linestrings only (not polygon rings). */
export function linesOf(g: Geom): Pt[][] {
  switch (g.type) {
    case "LineString":
      return [g.coordinates]
    case "MultiLineString":
      return g.coordinates
    case "GeometryCollection":
      return g.geometries.flatMap((x) => linesOf(x))
    default:
      return []
  }
}

/** Lone points only (not vertices of lines/polygons). */
export function pointsOf(g: Geom): Pt[] {
  switch (g.type) {
    case "Point":
      return [g.coordinates]
    case "MultiPoint":
      return g.coordinates
    case "GeometryCollection":
      return g.geometries.flatMap((x) => pointsOf(x))
    default:
      return []
  }
}

/** All polygons as arrays of rings (ring 0 = outer). */
export function polygonsOf(g: Geom): Pt[][][] {
  switch (g.type) {
    case "Polygon":
      return [g.coordinates]
    case "MultiPolygon":
      return g.coordinates
    case "GeometryCollection":
      return g.geometries.flatMap((x) => polygonsOf(x))
    default:
      return []
  }
}

/** Every segment: open ones from lines, closed ones from polygon rings. */
export function segmentsOf(g: Geom): Array<[Pt, Pt]> {
  const segs: Array<[Pt, Pt]> = []
  for (const line of linesOf(g)) {
    for (let i = 0; i < line.length - 1; i++) segs.push([line[i], line[i + 1]])
  }
  for (const poly of polygonsOf(g)) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        segs.push([ring[i], ring[(i + 1) % ring.length]])
      }
    }
  }
  return segs
}

export function geomKind(
  g: Geom,
): "empty" | "point" | "line" | "polygon" | "mixed" {
  const kinds = new Set<string>()
  const walk = (x: Geom): void => {
    switch (x.type) {
      case "Point":
      case "MultiPoint":
        kinds.add("point")
        break
      case "LineString":
      case "MultiLineString":
        kinds.add("line")
        break
      case "Polygon":
      case "MultiPolygon":
        kinds.add("polygon")
        break
      case "GeometryCollection":
        x.geometries.forEach(walk)
        break
    }
  }
  walk(g)
  if (kinds.size === 0) return "empty"
  if (kinds.size > 1) return "mixed"
  return [...kinds][0] as "point" | "line" | "polygon"
}

export function translateGeom(g: Geom, dx: number, dy: number): Geom {
  const mv = (p: Pt): Pt => [p[0] + dx, p[1] + dy]
  switch (g.type) {
    case "Point":
      return { type: "Point", coordinates: mv(g.coordinates) }
    case "MultiPoint":
      return { type: "MultiPoint", coordinates: g.coordinates.map(mv) }
    case "LineString":
      return { type: "LineString", coordinates: g.coordinates.map(mv) }
    case "MultiLineString":
      return {
        type: "MultiLineString",
        coordinates: g.coordinates.map((l) => l.map(mv)),
      }
    case "Polygon":
      return { type: "Polygon", coordinates: g.coordinates.map((r) => r.map(mv)) }
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: g.coordinates.map((p) => p.map((r) => r.map(mv))),
      }
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: g.geometries.map((x) => translateGeom(x, dx, dy)),
      }
  }
}

const GEOM_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
])

function cleanPosition(p: unknown): Pt | null {
  if (!Array.isArray(p) || p.length < 2) return null
  const x = Number(p[0])
  const y = Number(p[1])
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return [x, y]
}

function cleanCoords(c: unknown, depth: number): unknown {
  if (depth === 0) return cleanPosition(c)
  if (!Array.isArray(c)) return null
  const out = c.map((x) => cleanCoords(x, depth - 1)).filter((x) => x !== null)
  return out.length > 0 ? out : null
}

function ringDepth(type: string): number {
  switch (type) {
    case "Point":
      return 0
    case "MultiPoint":
    case "LineString":
      return 1
    case "MultiLineString":
    case "Polygon":
      return 2
    case "MultiPolygon":
      return 3
    default:
      return 0
  }
}

/** Unclose polygon rings (our model keeps rings unclosed). */
function uncloseRings(g: Geom): Geom {
  const fix = (ring: Pt[]): Pt[] => {
    if (ring.length > 3) {
      const a = ring[0]
      const b = ring[ring.length - 1]
      if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1)
    }
    return ring
  }
  if (g.type === "Polygon") {
    return { type: "Polygon", coordinates: g.coordinates.map(fix) }
  }
  if (g.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: g.coordinates.map((p) => p.map(fix)),
    }
  }
  if (g.type === "GeometryCollection") {
    return {
      type: "GeometryCollection",
      geometries: g.geometries.map(uncloseRings),
    }
  }
  return g
}

/** Parse any GeoJSON value (geometry / Feature / FeatureCollection). */
export function fromGeoJSON(input: unknown): Geom | null {
  if (input == null || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const type = obj.type as string | undefined
  if (type === "FeatureCollection") {
    const feats = Array.isArray(obj.features) ? obj.features : []
    const geoms = feats
      .map((f: unknown) =>
        f && typeof f === "object"
          ? fromGeoJSON((f as Record<string, unknown>).geometry)
          : null,
      )
      .filter((g): g is Geom => g !== null)
    if (geoms.length === 0) return null
    if (geoms.length === 1) return geoms[0]
    return { type: "GeometryCollection", geometries: geoms }
  }
  if (type === "Feature") {
    return fromGeoJSON(obj.geometry)
  }
  if (type === "GeometryCollection") {
    const list = Array.isArray(obj.geometries) ? obj.geometries : []
    const geoms = list
      .map((x: unknown) => fromGeoJSON(x))
      .filter((g): g is Geom => g !== null)
    if (geoms.length === 0) return null
    if (geoms.length === 1) return geoms[0]
    return { type: "GeometryCollection", geometries: geoms }
  }
  if (typeof type === "string" && GEOM_TYPES.has(type)) {
    const coords = cleanCoords(obj.coordinates, ringDepth(type))
    if (coords === null) return null
    const g = { type, coordinates: coords } as Geom
    return uncloseRings(g)
  }
  return null
}

/** Serialize to standard GeoJSON (closing polygon rings). */
export function toGeoJSON(g: Geom): Record<string, unknown> {
  const close = (ring: Pt[]): Pt[] =>
    ring.length >= 3 ? [...ring, [ring[0][0], ring[0][1]] as Pt] : ring
  switch (g.type) {
    case "Polygon":
      return { type: "Polygon", coordinates: g.coordinates.map(close) }
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: g.coordinates.map((p) => p.map(close)),
      }
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: g.geometries.map((x) => toGeoJSON(x)),
      }
    default:
      return JSON.parse(JSON.stringify(g)) as Record<string, unknown>
  }
}
