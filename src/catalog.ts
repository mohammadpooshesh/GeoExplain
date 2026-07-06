// The function catalog: every spatial function with its documentation,
// parameters, equivalent code snippets, and step-by-step animation frames.

import {
  Geom,
  Pt,
  cloneGeom,
  geomKind,
  linesOf,
  translateGeom,
  verticesOf,
} from "./geo/types"
import {
  areaOf,
  azimuthDeg,
  bboxOf,
  centroidOf,
  closestPair,
  farthestPair,
  fmt,
  lengthOf,
  perimeterOf,
} from "./geo/measure"
import {
  circlePolygon,
  convexHull,
  isClosedGeom,
  minimumBoundingCircle,
  removeRepeated,
  segmentize,
  selfIntersections,
  simplifyDP,
  simplifyRingDP,
  simplifyVW,
  snapGeom,
  transformPaths,
} from "./geo/algorithms"
import {
  booleanOp,
  bufferGeom,
  concaveHullGeom,
  dissolveGeom,
  interiorPoint,
  makeValidGeom,
  splitGeom,
} from "./geo/field"

export type Role = "a" | "b" | "result" | "accent" | "bad" | "ghost"

export type Layer = {
  geom: Geom
  role: Role
  opacity?: number
  dashed?: boolean
  showVertices?: boolean
  wide?: boolean
}

export type Frame = { label: string; layers: Layer[] }

export type ParamDef = {
  key: string
  label: string
  min: number
  max: number
  step: number
  def: number
  unit?: string
}

export type CodeSnippets = {
  postgis: string
  turf: string
  shapely: string
  gdal: string
}

export type RunOutput = {
  ok: boolean
  message?: string
  result: Geom | null
  value?: string
  frames: Frame[]
}

export type FnDef = {
  name: string
  category: string
  needsB: boolean
  bHint?: string
  summary: string
  doc: string[]
  params: ParamDef[]
  code: (p: Record<string, number>) => CodeSnippets
  run: (a: Geom, b: Geom | null, p: Record<string, number>) => RunOutput
}

// ------------------------------------------------------------------- helpers

function layer(geom: Geom, role: Role, extra?: Partial<Layer>): Layer {
  return { geom, role, ...extra }
}

function fail(message: string): RunOutput {
  return { ok: false, message, result: null, frames: [] }
}

function inputLayers(a: Geom, b: Geom | null): Layer[] {
  const out: Layer[] = [layer(a, "a", { showVertices: true })]
  if (b) out.push(layer(b, "b", { showVertices: true }))
  return out
}

function ptGeom(p: Pt): Geom {
  return { type: "Point", coordinates: [p[0], p[1]] }
}

function multiPt(pts: Pt[]): Geom {
  return { type: "MultiPoint", coordinates: pts.map((p) => [p[0], p[1]] as Pt) }
}

function lineGeom(a: Pt, b: Pt): Geom {
  return { type: "LineString", coordinates: [[a[0], a[1]], [b[0], b[1]]] }
}

function polyFromRing(ring: Pt[]): Geom {
  return { type: "Polygon", coordinates: [ring] }
}

function needsGeom(a: Geom | null): a is Geom {
  return a !== null && verticesOf(a).length > 0
}

function simplifyGeomDP(g: Geom, tol: number): Geom {
  return transformPaths(g, (pts, closed) =>
    closed ? simplifyRingDP(pts, tol) : simplifyDP(pts, tol),
  )
}

function simplifyGeomVW(g: Geom, tolArea: number): Geom {
  return transformPaths(g, (pts, closed) => simplifyVW(pts, tolArea, closed))
}

function measureOutput(
  a: Geom,
  b: Geom | null,
  value: string,
  extras: Layer[],
  label: string,
): RunOutput {
  return {
    ok: true,
    result: null,
    value,
    frames: [
      { label: "Input", layers: inputLayers(a, b) },
      { label, layers: [...inputLayers(a, b), ...extras] },
    ],
  }
}

// ------------------------------------------------------------------ Geometry

const stBuffer: FnDef = {
  name: "ST_Buffer",
  category: "Geometry",
  needsB: false,
  summary: "All points within a distance from the input geometry.",
  doc: [
    "ST_Buffer returns a polygon covering every point within the given distance of the input. Points become discs, lines become corridors, polygons grow outward (or shrink with a negative distance).",
    "Watch the buffer grow in steps: the boundary is the iso-distance contour of the input, which is why corners come out rounded.",
    "Distance controls how far the boundary moves. Negative distances erode polygons and can make them vanish.",
  ],
  params: [
    { key: "distance", label: "Distance", min: -60, max: 120, step: 1, def: 40 },
  ],
  code: (p) => ({
    postgis: "SELECT ST_Buffer(geom, " + p.distance + ")\nFROM my_table;",
    turf: "const out = turf.buffer(feature, " + p.distance + ", {\n  units: \"meters\",\n})",
    shapely: "out = geometry.buffer(" + p.distance + ")",
    gdal: "out = geom.Buffer(" + p.distance + ")",
  }),
  run: (a, _b, p) => {
    const d = p.distance
    if (d < 0 && geomKind(a) !== "polygon") {
      return fail("Negative distances only make sense for polygons.")
    }
    const frames: Frame[] = [{ label: "Input", layers: inputLayers(a, null) }]
    for (const t of [0.34, 0.67]) {
      const partial = bufferGeom(a, d * t, 120)
      if (partial) {
        frames.push({
          label: "Expanding " + Math.round(t * 100) + "%",
          layers: [
            layer(a, "a", { opacity: 0.55 }),
            layer(partial, "accent", { dashed: true, opacity: 0.8 }),
          ],
        })
      }
    }
    const result = bufferGeom(a, d)
    if (!result) return fail("The buffer is empty (geometry fully eroded).")
    frames.push({
      label: "Final geometry",
      layers: [layer(a, "a", { opacity: 0.45 }), layer(result, "result")],
    })
    return { ok: true, result, frames }
  },
}

function booleanFn(
  name: string,
  op: "union" | "intersection" | "difference" | "symdifference",
  summary: string,
  doc: string[],
  code: CodeSnippets,
  midLabel: string,
  midRole: Role,
): FnDef {
  return {
    name,
    category: "Geometry",
    needsB: true,
    bHint: "Second geometry (B)",
    summary,
    doc,
    params: [],
    code: () => code,
    run: (a, b) => {
      if (!needsGeom(b)) return fail("This function needs geometry B. Draw it or load a sample.")
      const frames: Frame[] = [{ label: "Input A + B", layers: inputLayers(a, b) }]
      const overlap = booleanOp(a, b, "intersection", 120)
      if (overlap) {
        frames.push({
          label: "Overlap detected",
          layers: [
            layer(a, "a", { opacity: 0.55 }),
            layer(b, "b", { opacity: 0.55 }),
            layer(overlap, midRole, { dashed: true }),
          ],
        })
      } else {
        frames.push({
          label: "No overlap",
          layers: [layer(a, "a", { opacity: 0.7 }), layer(b, "b", { opacity: 0.7 })],
        })
      }
      const result = booleanOp(a, b, op)
      if (!result) {
        return {
          ok: true,
          result: null,
          message: midLabel + " produced an empty geometry.",
          frames,
        }
      }
      frames.push({
        label: midLabel,
        layers: [
          layer(a, "ghost", { opacity: 0.25, dashed: true }),
          layer(b, "ghost", { opacity: 0.25, dashed: true }),
          layer(result, "result"),
        ],
      })
      return { ok: true, result, frames }
    },
  }
}

const stUnion = booleanFn(
  "ST_Union",
  "union",
  "Merges two geometries into one, dissolving shared boundaries.",
  [
    "ST_Union computes the set union of A and B. Where the shapes overlap, interior boundaries disappear and one merged geometry remains.",
    "The middle step highlights the overlapping region that will be dissolved.",
  ],
  {
    postgis: "SELECT ST_Union(a.geom, b.geom)\nFROM a, b;",
    turf: "const out = turf.union(\n  turf.featureCollection([a, b]),\n)",
    shapely: "out = a.union(b)",
    gdal: "out = a.Union(b)",
  },
  "Merged",
  "accent",
)

const stDifference = booleanFn(
  "ST_Difference",
  "difference",
  "Removes from A everything covered by B.",
  [
    "ST_Difference subtracts B from A: the part of A that lies inside B is cut away and only the remaining area of A is returned.",
    "The middle step highlights the region of A that will be removed.",
  ],
  {
    postgis: "SELECT ST_Difference(a.geom, b.geom)\nFROM a, b;",
    turf: "const out = turf.difference(\n  turf.featureCollection([a, b]),\n)",
    shapely: "out = a.difference(b)",
    gdal: "out = a.Difference(b)",
  },
  "Remaining area",
  "bad",
)

const stIntersection = booleanFn(
  "ST_Intersection",
  "intersection",
  "Keeps only the area shared by A and B.",
  [
    "ST_Intersection returns the region common to both inputs. If A and B do not overlap, the result is empty.",
  ],
  {
    postgis: "SELECT ST_Intersection(a.geom, b.geom)\nFROM a, b;",
    turf: "const out = turf.intersect(\n  turf.featureCollection([a, b]),\n)",
    shapely: "out = a.intersection(b)",
    gdal: "out = a.Intersection(b)",
  },
  "Shared area",
  "accent",
)

const stSymDifference = booleanFn(
  "ST_SymDifference",
  "symdifference",
  "Keeps the parts of A and B that do not overlap.",
  [
    "ST_SymDifference is the exclusive-or of the two shapes: everything covered by exactly one input. The shared region is removed from both.",
  ],
  {
    postgis: "SELECT ST_SymDifference(a.geom, b.geom)\nFROM a, b;",
    turf: "// union minus intersection\nconst u = turf.union(turf.featureCollection([a, b]))\nconst i = turf.intersect(turf.featureCollection([a, b]))\nconst out = i ? turf.difference(turf.featureCollection([u, i])) : u",
    shapely: "out = a.symmetric_difference(b)",
    gdal: "out = a.SymDifference(b)",
  },
  "Exclusive area",
  "bad",
)

const stSplit: FnDef = {
  name: "ST_Split",
  category: "Geometry",
  needsB: true,
  bHint: "Blade — draw a line as B",
  summary: "Cuts geometry A with blade line B.",
  doc: [
    "ST_Split cuts the input geometry with a blade (usually a line). A polygon crossed by a line falls apart into separate polygons.",
    "The animation shows the blade, then pulls the resulting parts slightly apart so you can see the cut. The actual result keeps the parts in place.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Split(a.geom, blade.geom)\nFROM a, blade;",
    turf: "// no direct equivalent; for lines see\n// turf.lineSplit(line, splitter)",
    shapely: "from shapely.ops import split\nout = split(geometry, blade)",
    gdal: "# no direct equivalent in GDAL/OGR",
  }),
  run: (a, b) => {
    if (!needsGeom(b)) return fail("Draw a blade line as geometry B.")
    if (geomKind(a) !== "polygon") return fail("Split is visualized for polygon A cut by line B.")
    const result = splitGeom(a, b)
    if (!result) return fail("The blade does not cut the polygon.")
    const frames: Frame[] = [
      { label: "Input", layers: inputLayers(a, b) },
      {
        label: "Cut by blade",
        layers: [layer(a, "a", { opacity: 0.6 }), layer(b, "bad", { wide: true })],
      },
    ]
    if (result.type === "MultiPolygon" && result.coordinates.length > 1) {
      const c = centroidOf(a) ?? [0, 0]
      const parts: Geom = {
        type: "GeometryCollection",
        geometries: result.coordinates.map((poly) => {
          const pg: Geom = { type: "Polygon", coordinates: poly }
          const pc = centroidOf(pg) ?? c
          const dx = pc[0] - c[0]
          const dy = pc[1] - c[1]
          const len = Math.hypot(dx, dy) || 1
          return translateGeom(pg, (dx / len) * 14, (dy / len) * 14)
        }),
      }
      frames.push({
        label: "Parts separated",
        layers: [layer(b, "ghost", { dashed: true, opacity: 0.4 }), layer(parts, "result")],
      })
    }
    frames.push({
      label: "Result",
      layers: [layer(b, "ghost", { dashed: true, opacity: 0.35 }), layer(result, "result")],
    })
    return { ok: true, result, frames }
  },
}

const stCollect: FnDef = {
  name: "ST_Collect",
  category: "Geometry",
  needsB: true,
  bHint: "Second geometry (B)",
  summary: "Bundles A and B into one geometry collection without merging.",
  doc: [
    "ST_Collect simply gathers geometries into a Multi* or GeometryCollection. Unlike ST_Union it performs no dissolving — overlapping boundaries are kept as-is.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Collect(a.geom, b.geom)\nFROM a, b;",
    turf: "const out = turf.featureCollection([a, b])",
    shapely: "from shapely import GeometryCollection\nout = GeometryCollection([a, b])",
    gdal: "coll = ogr.Geometry(ogr.wkbGeometryCollection)\ncoll.AddGeometry(a)\ncoll.AddGeometry(b)",
  }),
  run: (a, b) => {
    if (!needsGeom(b)) return fail("This function needs geometry B.")
    const result: Geom = {
      type: "GeometryCollection",
      geometries: [cloneGeom(a), cloneGeom(b)],
    }
    return {
      ok: true,
      result,
      frames: [
        { label: "Input A + B", layers: inputLayers(a, b) },
        { label: "Collected (no merge)", layers: [layer(result, "result", { showVertices: true })] },
      ],
    }
  },
}

const stUnaryUnion: FnDef = {
  name: "ST_UnaryUnion",
  category: "Geometry",
  needsB: false,
  summary: "Dissolves a single (multi)geometry, removing internal overlaps.",
  doc: [
    "ST_UnaryUnion unions all components of one input geometry: overlapping members of a collection or self-overlapping parts are dissolved into a clean result.",
    "Tip: import a GeoJSON with several overlapping polygons into A to see the dissolve.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_UnaryUnion(geom)\nFROM my_table;",
    turf: "// union all parts\nconst out = turf.union(featureCollection)",
    shapely: "from shapely.ops import unary_union\nout = unary_union(geometry)",
    gdal: "out = geom.UnionCascaded()",
  }),
  run: (a) => {
    if (geomKind(a) === "point") return fail("UnaryUnion is visualized for lines and polygons.")
    const result = dissolveGeom(a)
    if (!result) return fail("Could not dissolve this geometry.")
    return {
      ok: true,
      result,
      frames: [
        { label: "Input", layers: inputLayers(a, null) },
        {
          label: "Dissolved",
          layers: [layer(a, "ghost", { dashed: true, opacity: 0.35 }), layer(result, "result")],
        },
      ],
    }
  },
}

// --------------------------------------------------------------- Measurement

const stArea: FnDef = {
  name: "ST_Area",
  category: "Measurement",
  needsB: false,
  summary: "Area of a polygonal geometry.",
  doc: [
    "ST_Area returns the area of polygons (holes are subtracted). Lines and points have zero area.",
    "GeoExplain works on a planar canvas, so the value is in square canvas units.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Area(geom)\nFROM my_table;",
    turf: "const value = turf.area(feature)",
    shapely: "value = geometry.area",
    gdal: "value = geom.GetArea()",
  }),
  run: (a) => {
    const v = areaOf(a)
    return measureOutput(a, null, fmt(v) + " units\u00b2", [layer(a, "accent", { opacity: 0.5 })], "Measured area")
  },
}

const stLength: FnDef = {
  name: "ST_Length",
  category: "Measurement",
  needsB: false,
  summary: "Length of linear geometry.",
  doc: [
    "ST_Length measures linestrings. In PostGIS, polygons return 0 for ST_Length — use ST_Perimeter for their boundary length.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Length(geom)\nFROM my_table;",
    turf: "const value = turf.length(feature, {\n  units: \"kilometers\",\n})",
    shapely: "value = geometry.length",
    gdal: "value = geom.Length()",
  }),
  run: (a) => {
    const v = lengthOf(a)
    const note = geomKind(a) === "polygon" ? " (polygons: use ST_Perimeter)" : ""
    return measureOutput(a, null, fmt(v) + " units" + note, [layer(a, "accent", { wide: true, opacity: 0.9 })], "Measured length")
  },
}

const stPerimeter: FnDef = {
  name: "ST_Perimeter",
  category: "Measurement",
  needsB: false,
  summary: "Boundary length of a polygonal geometry.",
  doc: [
    "ST_Perimeter measures the total length of all polygon boundaries, including hole rings.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Perimeter(geom)\nFROM my_table;",
    turf: "const line = turf.polygonToLine(feature)\nconst value = turf.length(line)",
    shapely: "value = geometry.length  # for polygons",
    gdal: "value = geom.Boundary().Length()",
  }),
  run: (a) => {
    if (geomKind(a) !== "polygon") return fail("Perimeter is defined for polygons. Try ST_Length for lines.")
    const v = perimeterOf(a)
    return measureOutput(a, null, fmt(v) + " units", [layer(a, "accent", { opacity: 0.35, showVertices: true })], "Measured perimeter")
  },
}

const stDistance: FnDef = {
  name: "ST_Distance",
  category: "Measurement",
  needsB: true,
  bHint: "Second geometry (B)",
  summary: "Minimum distance between A and B.",
  doc: [
    "ST_Distance returns the shortest distance between two geometries — zero when they touch or overlap.",
    "The highlighted connector shows where the two shapes are closest.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Distance(a.geom, b.geom)\nFROM a, b;",
    turf: "const value = turf.distance(pointA, pointB)\n// polygons: turf.pointToPolygonDistance, etc.",
    shapely: "value = a.distance(b)",
    gdal: "value = a.Distance(b)",
  }),
  run: (a, b) => {
    if (!needsGeom(b)) return fail("This function needs geometry B.")
    const pair = closestPair(a, b)
    if (!pair) return fail("Could not measure distance.")
    const extras: Layer[] = [
      layer(lineGeom(pair.p, pair.q), "accent", { dashed: true, wide: true }),
      layer(multiPt([pair.p, pair.q]), "accent", { showVertices: true }),
    ]
    return measureOutput(a, b, fmt(pair.d) + " units", extras, "Closest approach")
  },
}

const stMaxDistance: FnDef = {
  name: "ST_MaxDistance",
  category: "Measurement",
  needsB: true,
  bHint: "Second geometry (B)",
  summary: "Maximum distance between A and B.",
  doc: [
    "ST_MaxDistance returns the largest distance between any two vertices of the inputs — how far apart the shapes reach.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_MaxDistance(a.geom, b.geom)\nFROM a, b;",
    turf: "// compare vertex pairs manually with turf.distance",
    shapely: "value = a.hausdorff_distance(b)  # related concept",
    gdal: "# no direct equivalent in GDAL/OGR",
  }),
  run: (a, b) => {
    if (!needsGeom(b)) return fail("This function needs geometry B.")
    const pair = farthestPair(a, b)
    if (!pair) return fail("Could not measure distance.")
    const extras: Layer[] = [
      layer(lineGeom(pair.p, pair.q), "bad", { dashed: true, wide: true }),
      layer(multiPt([pair.p, pair.q]), "bad", { showVertices: true }),
    ]
    return measureOutput(a, b, fmt(pair.d) + " units", extras, "Farthest vertices")
  },
}

const stAzimuth: FnDef = {
  name: "ST_Azimuth",
  category: "Measurement",
  needsB: true,
  bHint: "Second geometry (B)",
  summary: "Compass bearing from A to B.",
  doc: [
    "ST_Azimuth returns the angle from north, clockwise, of the direction from point A to point B. GeoExplain uses the centroids when the inputs are not points.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT degrees(\n  ST_Azimuth(a.geom, b.geom)\n)\nFROM a, b;",
    turf: "const value = turf.bearing(pointA, pointB)\n// -180..180, from north",
    shapely: "import math\nvalue = math.degrees(math.atan2(\n  b.x - a.x, b.y - a.y\n)) % 360",
    gdal: "# compute from coordinates manually",
  }),
  run: (a, b) => {
    if (!needsGeom(b)) return fail("This function needs geometry B.")
    const ca = centroidOf(a)
    const cb = centroidOf(b)
    if (!ca || !cb) return fail("Could not find centroids.")
    const deg = azimuthDeg(ca, cb)
    const extras: Layer[] = [
      layer(lineGeom(ca, cb), "accent", { wide: true }),
      layer(lineGeom(ca, [ca[0], ca[1] - 60]), "ghost", { dashed: true }),
      layer(multiPt([ca, cb]), "accent", { showVertices: true }),
    ]
    return measureOutput(a, b, fmt(deg) + "\u00b0 from north", extras, "Bearing A \u2192 B")
  },
}

// ---------------------------------------------------------------- Processing

const stSimplify: FnDef = {
  name: "ST_Simplify",
  category: "Processing",
  needsB: false,
  summary: "Removes vertices using Douglas-Peucker within a tolerance.",
  doc: [
    "ST_Simplify drops vertices that deviate from the overall shape by less than the tolerance (Douglas-Peucker). Larger tolerance = fewer vertices, coarser shape.",
    "The animation ramps the tolerance up so you can watch vertices disappear.",
  ],
  params: [
    { key: "tolerance", label: "Tolerance", min: 0, max: 40, step: 0.5, def: 8 },
  ],
  code: (p) => ({
    postgis: "SELECT ST_Simplify(geom, " + p.tolerance + ")\nFROM my_table;",
    turf: "const out = turf.simplify(feature, {\n  tolerance: " + p.tolerance + ",\n  highQuality: false,\n})",
    shapely: "out = geometry.simplify(" + p.tolerance + ",\n  preserve_topology=True)",
    gdal: "out = geom.Simplify(" + p.tolerance + ")",
  }),
  run: (a, _b, p) => {
    const tol = p.tolerance
    const before = verticesOf(a).length
    const frames: Frame[] = [{ label: "Original (" + before + " vertices)", layers: inputLayers(a, null) }]
    for (const t of [0.4, 0.7]) {
      const partial = simplifyGeomDP(a, tol * t)
      frames.push({
        label: "Tolerance " + fmt(tol * t),
        layers: [layer(a, "ghost", { dashed: true, opacity: 0.3 }), layer(partial, "accent", { showVertices: true })],
      })
    }
    const result = simplifyGeomDP(a, tol)
    const after = verticesOf(result).length
    frames.push({
      label: "Simplified (" + after + " vertices)",
      layers: [layer(a, "ghost", { dashed: true, opacity: 0.3 }), layer(result, "result", { showVertices: true })],
    })
    return { ok: true, result, value: before + " \u2192 " + after + " vertices", frames }
  },
}

const stSimplifyVW: FnDef = {
  name: "ST_SimplifyVW",
  category: "Processing",
  needsB: false,
  summary: "Simplifies using Visvalingam-Whyatt effective areas.",
  doc: [
    "ST_SimplifyVW removes the vertex whose triangle with its neighbors has the smallest area, repeatedly, until every remaining vertex matters more than the tolerance area.",
    "Compared to Douglas-Peucker it tends to keep the overall character of the shape better.",
  ],
  params: [
    { key: "tolArea", label: "Tolerance area", min: 0, max: 1500, step: 10, def: 200 },
  ],
  code: (p) => ({
    postgis: "SELECT ST_SimplifyVW(geom, " + p.tolArea + ")\nFROM my_table;",
    turf: "// turf.simplify uses Douglas-Peucker;\n// no VW variant in Turf.js",
    shapely: "# shapely 2.x: use simplify() (DP)\n# or simplification package for VW",
    gdal: "# no direct VW equivalent",
  }),
  run: (a, _b, p) => {
    const before = verticesOf(a).length
    const result = simplifyGeomVW(a, p.tolArea)
    const mid = simplifyGeomVW(a, p.tolArea * 0.4)
    const after = verticesOf(result).length
    return {
      ok: true,
      result,
      value: before + " \u2192 " + after + " vertices",
      frames: [
        { label: "Original (" + before + " vertices)", layers: inputLayers(a, null) },
        {
          label: "Dropping small triangles",
          layers: [layer(a, "ghost", { dashed: true, opacity: 0.3 }), layer(mid, "accent", { showVertices: true })],
        },
        {
          label: "Simplified (" + after + " vertices)",
          layers: [layer(a, "ghost", { dashed: true, opacity: 0.3 }), layer(result, "result", { showVertices: true })],
        },
      ],
    }
  },
}

const stSnap: FnDef = {
  name: "ST_Snap",
  category: "Processing",
  needsB: true,
  bHint: "Snap target (B)",
  summary: "Moves vertices of A onto nearby vertices/edges of B.",
  doc: [
    "ST_Snap adjusts geometry A so that vertices within the tolerance of geometry B jump onto B's vertices or edges. It is used to fix tiny gaps before overlays.",
    "Arrows show which vertices moved and where they landed.",
  ],
  params: [
    { key: "tolerance", label: "Tolerance", min: 0, max: 80, step: 1, def: 30 },
  ],
  code: (p) => ({
    postgis: "SELECT ST_Snap(a.geom, b.geom, " + p.tolerance + ")\nFROM a, b;",
    turf: "// no direct equivalent in Turf.js",
    shapely: "from shapely.ops import snap\nout = snap(a, b, " + p.tolerance + ")",
    gdal: "# no direct equivalent in GDAL/OGR",
  }),
  run: (a, b, p) => {
    if (!needsGeom(b)) return fail("This function needs a snap target B.")
    const { geom: result, moves } = snapGeom(a, b, p.tolerance)
    const frames: Frame[] = [{ label: "Input", layers: inputLayers(a, b) }]
    if (moves.length > 0) {
      const arrows: Geom = {
        type: "MultiLineString",
        coordinates: moves.map((m) => [[m.from[0], m.from[1]], [m.to[0], m.to[1]]] as Pt[]),
      }
      frames.push({
        label: moves.length + " vertices snapping",
        layers: [
          layer(a, "a", { opacity: 0.4 }),
          layer(b, "b", { opacity: 0.7 }),
          layer(arrows, "accent", { dashed: true, wide: true }),
          layer(multiPt(moves.map((m) => m.to)), "accent", { showVertices: true }),
        ],
      })
    }
    frames.push({
      label: moves.length > 0 ? "Snapped" : "Nothing within tolerance",
      layers: [
        layer(b, "b", { opacity: 0.6 }),
        layer(result, "result", { showVertices: true }),
      ],
    })
    return { ok: true, result, value: moves.length + " vertices moved", frames }
  },
}

const stRemoveRepeated: FnDef = {
  name: "ST_RemoveRepeatedPoints",
  category: "Processing",
  needsB: false,
  summary: "Drops consecutive vertices closer than the tolerance.",
  doc: [
    "ST_RemoveRepeatedPoints removes consecutive duplicate (or nearly duplicate) vertices. It is a cheap cleanup for noisy traces.",
  ],
  params: [
    { key: "tolerance", label: "Tolerance", min: 0, max: 30, step: 0.5, def: 4 },
  ],
  code: (p) => ({
    postgis: "SELECT ST_RemoveRepeatedPoints(geom, " + p.tolerance + ")\nFROM my_table;",
    turf: "const out = turf.cleanCoords(feature)",
    shapely: "from shapely import remove_repeated_points\nout = remove_repeated_points(geometry,\n  tolerance=" + p.tolerance + ")",
    gdal: "# use geom.Simplify(0) as an approximation",
  }),
  run: (a, _b, p) => {
    const before = verticesOf(a).length
    const result = transformPaths(a, (pts, closed) => removeRepeated(pts, p.tolerance, closed))
    const after = verticesOf(result).length
    return {
      ok: true,
      result,
      value: before + " \u2192 " + after + " vertices",
      frames: [
        { label: "Original (" + before + " vertices)", layers: inputLayers(a, null) },
        {
          label: "Cleaned (" + after + " vertices)",
          layers: [layer(a, "ghost", { dashed: true, opacity: 0.3 }), layer(result, "result", { showVertices: true })],
        },
      ],
    }
  },
}

const stReverse: FnDef = {
  name: "ST_Reverse",
  category: "Processing",
  needsB: false,
  summary: "Reverses the vertex order of lines and rings.",
  doc: [
    "ST_Reverse flips the direction of every path: the first vertex becomes the last. Direction matters for ring orientation rules and for line-referencing systems.",
    "The large marker shows the start vertex before and after.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Reverse(geom)\nFROM my_table;",
    turf: "const out = turf.rewind(feature, {\n  reverse: true,\n})",
    shapely: "out = geometry.reverse()",
    gdal: "# lines: use geom.GetPoints()[::-1]",
  }),
  run: (a) => {
    const result = transformPaths(a, (pts) => [...pts].reverse())
    const startsBefore = [...linesOf(a).map((l) => l[0]), ...verticesOf(a).slice(0, 0)]
    const startsAfter = linesOf(result).map((l) => l[0])
    const frames: Frame[] = [
      {
        label: "Original direction",
        layers: [
          layer(a, "a", { showVertices: true }),
          ...(startsBefore.length > 0 ? [layer(multiPt(startsBefore), "accent", { showVertices: true, wide: true })] : []),
        ],
      },
      {
        label: "Reversed",
        layers: [
          layer(result, "result", { showVertices: true }),
          ...(startsAfter.length > 0 ? [layer(multiPt(startsAfter), "accent", { showVertices: true, wide: true })] : []),
        ],
      },
    ]
    return { ok: true, result, frames }
  },
}

const stSegmentize: FnDef = {
  name: "ST_Segmentize",
  category: "Processing",
  needsB: false,
  summary: "Adds vertices so no segment exceeds a maximum length.",
  doc: [
    "ST_Segmentize densifies a geometry: long segments are subdivided until each piece is shorter than the maximum length. The shape itself does not change — only the vertex count grows.",
  ],
  params: [
    { key: "maxLen", label: "Max segment length", min: 5, max: 120, step: 1, def: 30 },
  ],
  code: (p) => ({
    postgis: "SELECT ST_Segmentize(geom, " + p.maxLen + ")\nFROM my_table;",
    turf: "// approximate with turf.lineChunk\nconst chunks = turf.lineChunk(line, " + p.maxLen + ")",
    shapely: "out = geometry.segmentize(" + p.maxLen + ")",
    gdal: "geom.Segmentize(" + p.maxLen + ")",
  }),
  run: (a, _b, p) => {
    const before = verticesOf(a).length
    const result = transformPaths(a, (pts, closed) => segmentize(pts, p.maxLen, closed))
    const after = verticesOf(result).length
    return {
      ok: true,
      result,
      value: before + " \u2192 " + after + " vertices",
      frames: [
        { label: "Original (" + before + " vertices)", layers: inputLayers(a, null) },
        {
          label: "Densified (" + after + " vertices)",
          layers: [layer(result, "result", { showVertices: true })],
        },
      ],
    }
  },
}

// ------------------------------------------------------------------ Analysis

const stConvexHull: FnDef = {
  name: "ST_ConvexHull",
  category: "Analysis",
  needsB: false,
  summary: "Smallest convex polygon containing the geometry.",
  doc: [
    "ST_ConvexHull wraps the geometry in the tightest convex polygon — imagine a rubber band stretched around all vertices.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_ConvexHull(geom)\nFROM my_table;",
    turf: "const out = turf.convex(feature)",
    shapely: "out = geometry.convex_hull",
    gdal: "out = geom.ConvexHull()",
  }),
  run: (a) => {
    const pts = verticesOf(a)
    if (pts.length < 3) return fail("Need at least 3 vertices for a hull.")
    const hull = convexHull(pts)
    const result = polyFromRing(hull)
    return {
      ok: true,
      result,
      frames: [
        { label: "Input vertices", layers: [layer(a, "a", { showVertices: true })] },
        {
          label: "Rubber band",
          layers: [layer(a, "a", { opacity: 0.5 }), layer(result, "accent", { dashed: true })],
        },
        {
          label: "Convex hull",
          layers: [layer(a, "ghost", { opacity: 0.35 }), layer(result, "result", { showVertices: true })],
        },
      ],
    }
  },
}

const stConcaveHull: FnDef = {
  name: "ST_ConcaveHull",
  category: "Analysis",
  needsB: false,
  summary: "A tighter, possibly concave, wrap around the geometry.",
  doc: [
    "ST_ConcaveHull hugs the input more closely than the convex hull. GeoExplain approximates it with a morphological closing over the vertices — the radius plays the role of the concaveness parameter.",
  ],
  params: [
    { key: "radius", label: "Hug radius", min: 15, max: 140, step: 1, def: 50 },
  ],
  code: (p) => ({
    postgis: "SELECT ST_ConcaveHull(geom, " + fmt(Math.min(0.99, p.radius / 140), 2) + ")\nFROM my_table;",
    turf: "const out = turf.concave(points, {\n  maxEdge: " + p.radius + ",\n})",
    shapely: "from shapely import concave_hull\nout = concave_hull(geometry,\n  ratio=" + fmt(Math.min(0.99, p.radius / 140), 2) + ")",
    gdal: "# no direct equivalent in GDAL/OGR",
  }),
  run: (a, _b, p) => {
    const result = concaveHullGeom(a, p.radius)
    if (!result) return fail("Need at least 3 vertices for a hull.")
    const pts = verticesOf(a)
    const hull = pts.length >= 3 ? polyFromRing(convexHull(pts)) : null
    return {
      ok: true,
      result,
      frames: [
        { label: "Input vertices", layers: [layer(a, "a", { showVertices: true })] },
        ...(hull
          ? [{
              label: "Convex hull (for comparison)",
              layers: [layer(a, "a", { opacity: 0.5 }), layer(hull, "ghost", { dashed: true })],
            }]
          : []),
        {
          label: "Concave hull",
          layers: [layer(a, "ghost", { opacity: 0.35 }), layer(result, "result")],
        },
      ],
    }
  },
}

const stCentroid: FnDef = {
  name: "ST_Centroid",
  category: "Analysis",
  needsB: false,
  summary: "Center of mass of the geometry.",
  doc: [
    "ST_Centroid returns the geometric center of mass. For concave shapes it can fall outside the geometry — compare with ST_PointOnSurface.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Centroid(geom)\nFROM my_table;",
    turf: "const out = turf.centroid(feature)",
    shapely: "out = geometry.centroid",
    gdal: "out = geom.Centroid()",
  }),
  run: (a) => {
    const c = centroidOf(a)
    if (!c) return fail("Empty geometry.")
    const result = ptGeom(c)
    return {
      ok: true,
      result,
      value: "(" + fmt(c[0]) + ", " + fmt(c[1]) + ")",
      frames: [
        { label: "Input", layers: inputLayers(a, null) },
        {
          label: "Center of mass",
          layers: [
            layer(a, "a", { opacity: 0.5 }),
            layer(lineGeom([c[0] - 14, c[1]], [c[0] + 14, c[1]]), "accent", {}),
            layer(lineGeom([c[0], c[1] - 14], [c[0], c[1] + 14]), "accent", {}),
            layer(result, "result", { showVertices: true, wide: true }),
          ],
        },
      ],
    }
  },
}

const stPointOnSurface: FnDef = {
  name: "ST_PointOnSurface",
  category: "Analysis",
  needsB: false,
  summary: "A point guaranteed to lie on the geometry.",
  doc: [
    "ST_PointOnSurface returns a representative point that is always inside the geometry — unlike the centroid, which may fall outside concave shapes. GeoExplain approximates the most interior point (pole of inaccessibility).",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_PointOnSurface(geom)\nFROM my_table;",
    turf: "const out = turf.pointOnFeature(feature)",
    shapely: "out = geometry.representative_point()",
    gdal: "out = geom.PointOnSurface()",
  }),
  run: (a) => {
    const ip = geomKind(a) === "polygon" ? interiorPoint(a) : null
    const c = ip ?? centroidOf(a)
    if (!c) return fail("Empty geometry.")
    const result = ptGeom(c)
    const cen = centroidOf(a)
    return {
      ok: true,
      result,
      value: "(" + fmt(c[0]) + ", " + fmt(c[1]) + ")",
      frames: [
        { label: "Input", layers: inputLayers(a, null) },
        {
          label: "Most interior point",
          layers: [
            layer(a, "a", { opacity: 0.5 }),
            ...(cen ? [layer(ptGeom(cen), "ghost", { showVertices: true, dashed: true })] : []),
            layer(result, "result", { showVertices: true, wide: true }),
          ],
        },
      ],
    }
  },
}

const stMBC: FnDef = {
  name: "ST_MinimumBoundingCircle",
  category: "Analysis",
  needsB: false,
  summary: "Smallest circle that contains the geometry.",
  doc: [
    "ST_MinimumBoundingCircle finds the smallest enclosing circle (computed here with Welzl's algorithm). Useful for coverage radii and rough shape statistics.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_MinimumBoundingCircle(geom)\nFROM my_table;",
    turf: "const center = turf.center(feature)\n// radius: max distance to vertices",
    shapely: "from shapely import minimum_bounding_circle\nout = minimum_bounding_circle(geometry)",
    gdal: "# no direct equivalent in GDAL/OGR",
  }),
  run: (a) => {
    const pts = verticesOf(a)
    const c = minimumBoundingCircle(pts)
    if (!c) return fail("Empty geometry.")
    const result = polyFromRing(circlePolygon(c))
    return {
      ok: true,
      result,
      value: "r = " + fmt(c.r),
      frames: [
        { label: "Input", layers: inputLayers(a, null) },
        {
          label: "Center + radius",
          layers: [
            layer(a, "a", { opacity: 0.55 }),
            layer(ptGeom(c.center), "accent", { showVertices: true }),
            layer(lineGeom(c.center, [c.center[0] + c.r, c.center[1]]), "accent", { dashed: true }),
          ],
        },
        {
          label: "Minimum bounding circle",
          layers: [layer(a, "a", { opacity: 0.55 }), layer(result, "result", { opacity: 0.85 })],
        },
      ],
    }
  },
}

const stEnvelope: FnDef = {
  name: "ST_Envelope",
  category: "Analysis",
  needsB: false,
  summary: "Axis-aligned bounding box of the geometry.",
  doc: [
    "ST_Envelope returns the minimal axis-aligned rectangle containing the geometry — the cheapest possible summary of its extent.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_Envelope(geom)\nFROM my_table;",
    turf: "const out = turf.envelope(feature)",
    shapely: "out = geometry.envelope",
    gdal: "minx, maxx, miny, maxy = geom.GetEnvelope()",
  }),
  run: (a) => {
    const bb = bboxOf(a)
    if (!bb) return fail("Empty geometry.")
    const ring: Pt[] = [
      [bb[0], bb[1]],
      [bb[2], bb[1]],
      [bb[2], bb[3]],
      [bb[0], bb[3]],
    ]
    const result = polyFromRing(ring)
    return {
      ok: true,
      result,
      frames: [
        { label: "Input", layers: inputLayers(a, null) },
        {
          label: "Bounding box",
          layers: [layer(a, "a", { opacity: 0.55 }), layer(result, "result", { opacity: 0.85, showVertices: true })],
        },
      ],
    }
  },
}

// ---------------------------------------------------------------- Validation

const stIsValid: FnDef = {
  name: "ST_IsValid",
  category: "Validation",
  needsB: false,
  summary: "Checks whether a polygon follows the validity rules.",
  doc: [
    "ST_IsValid tests OGC validity: rings must not self-intersect or cross each other. Invalid polygons break overlays and measurements in subtle ways.",
    "Red markers show detected self-intersections. Draw a bow-tie polygon to see it fail.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_IsValid(geom),\n  ST_IsValidReason(geom)\nFROM my_table;",
    turf: "// turf has no validity check;\n// see the booleanValid draft or check in PostGIS",
    shapely: "ok = geometry.is_valid\nfrom shapely.validation import explain_validity\nreason = explain_validity(geometry)",
    gdal: "ok = geom.IsValid()",
  }),
  run: (a) => {
    if (geomKind(a) !== "polygon") return fail("Validity is visualized for polygons.")
    const hits = selfIntersections(a)
    const valid = hits.length === 0
    const frames: Frame[] = [{ label: "Input", layers: inputLayers(a, null) }]
    frames.push({
      label: valid ? "No self-intersections" : hits.length + " self-intersection(s)",
      layers: [
        layer(a, valid ? "result" : "a", { opacity: 0.7 }),
        ...(valid ? [] : [layer(multiPt(hits), "bad", { showVertices: true, wide: true })]),
      ],
    })
    return { ok: true, result: null, value: valid ? "true" : "false", frames }
  },
}

const stIsSimple: FnDef = {
  name: "ST_IsSimple",
  category: "Validation",
  needsB: false,
  summary: "Checks that the geometry has no self-intersections.",
  doc: [
    "ST_IsSimple is mostly interesting for lines: a simple line never crosses itself. Red markers show where the path self-intersects.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_IsSimple(geom)\nFROM my_table;",
    turf: "const kinks = turf.kinks(line)\nconst simple = kinks.features.length === 0",
    shapely: "ok = geometry.is_simple",
    gdal: "ok = geom.IsSimple()",
  }),
  run: (a) => {
    const hits = selfIntersections(a)
    const simple = hits.length === 0
    return {
      ok: true,
      result: null,
      value: simple ? "true" : "false",
      frames: [
        { label: "Input", layers: inputLayers(a, null) },
        {
          label: simple ? "No self-crossings" : hits.length + " self-crossing(s)",
          layers: [
            layer(a, simple ? "result" : "a", { opacity: 0.75 }),
            ...(simple ? [] : [layer(multiPt(hits), "bad", { showVertices: true, wide: true })]),
          ],
        },
      ],
    }
  },
}

const stMakeValid: FnDef = {
  name: "ST_MakeValid",
  category: "Validation",
  needsB: false,
  summary: "Repairs an invalid geometry without losing area.",
  doc: [
    "ST_MakeValid rebuilds a broken polygon into a valid one — a bow-tie becomes two triangles. GeoExplain re-extracts the shape from its own distance field with even-odd filling.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_MakeValid(geom)\nFROM my_table;",
    turf: "// no direct equivalent in Turf.js",
    shapely: "from shapely.validation import make_valid\nout = make_valid(geometry)",
    gdal: "out = geom.MakeValid()",
  }),
  run: (a) => {
    if (geomKind(a) !== "polygon") return fail("MakeValid is visualized for polygons.")
    const hits = selfIntersections(a)
    const result = makeValidGeom(a)
    if (!result) return fail("Could not rebuild this geometry.")
    const frames: Frame[] = [{ label: "Input", layers: inputLayers(a, null) }]
    if (hits.length > 0) {
      frames.push({
        label: "Problems found",
        layers: [layer(a, "a", { opacity: 0.6 }), layer(multiPt(hits), "bad", { showVertices: true, wide: true })],
      })
    }
    frames.push({
      label: "Rebuilt valid geometry",
      layers: [layer(a, "ghost", { dashed: true, opacity: 0.3 }), layer(result, "result")],
    })
    return { ok: true, result, value: hits.length === 0 ? "already valid" : "repaired", frames }
  },
}

const stIsClosed: FnDef = {
  name: "ST_IsClosed",
  category: "Validation",
  needsB: false,
  summary: "Checks whether lines end where they start.",
  doc: [
    "ST_IsClosed is true when every linestring's first and last points coincide. Points and polygons are closed by definition.",
    "The markers show the endpoints of each open line.",
  ],
  params: [],
  code: () => ({
    postgis: "SELECT ST_IsClosed(geom)\nFROM my_table;",
    turf: "const c = line.geometry.coordinates\nconst closed = turf.booleanEqual(\n  turf.point(c[0]),\n  turf.point(c[c.length - 1]),\n)",
    shapely: "ok = geometry.is_closed",
    gdal: "ok = geom.IsRing()",
  }),
  run: (a) => {
    const closed = isClosedGeom(a)
    const ends: Pt[] = []
    for (const line of linesOf(a)) {
      if (line.length >= 2) {
        ends.push(line[0], line[line.length - 1])
      }
    }
    return {
      ok: true,
      result: null,
      value: closed ? "true" : "false",
      frames: [
        { label: "Input", layers: inputLayers(a, null) },
        {
          label: closed ? "Closed" : "Open endpoints",
          layers: [
            layer(a, closed ? "result" : "a", { opacity: 0.75 }),
            ...(ends.length > 0 && !closed ? [layer(multiPt(ends), "bad", { showVertices: true, wide: true })] : []),
          ],
        },
      ],
    }
  },
}

// ------------------------------------------------------------------- catalog

export const CATALOG: Array<{ category: string; fns: FnDef[] }> = [
  {
    category: "Geometry",
    fns: [stBuffer, stUnion, stDifference, stIntersection, stSymDifference, stSplit, stCollect, stUnaryUnion],
  },
  {
    category: "Measurement",
    fns: [stArea, stLength, stPerimeter, stDistance, stMaxDistance, stAzimuth],
  },
  {
    category: "Processing",
    fns: [stSimplify, stSimplifyVW, stSnap, stRemoveRepeated, stReverse, stSegmentize],
  },
  {
    category: "Analysis",
    fns: [stConvexHull, stConcaveHull, stCentroid, stPointOnSurface, stMBC, stEnvelope],
  },
  {
    category: "Validation",
    fns: [stIsValid, stIsSimple, stMakeValid, stIsClosed],
  },
]

export const ALL_FNS: FnDef[] = CATALOG.flatMap((c) => c.fns)

export const DEFAULT_FN = "ST_Buffer"

export function findFn(name: string): FnDef {
  return ALL_FNS.find((f) => f.name === name) ?? ALL_FNS[0]
}

export function defaultParams(fn: FnDef): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of fn.params) out[p.key] = p.def
  return out
}
