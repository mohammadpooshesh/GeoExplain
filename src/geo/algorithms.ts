import { Geom, Pt, cloneGeom, linesOf, verticesOf } from "./types"
import { pointSegDist } from "./measure"

// ---------------------------------------------------------------- convex hull

/** Andrew's monotone chain. Returns an unclosed hull ring. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = [...new Map(points.map((p) => [p[0] + ":" + p[1], p])).values()]
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length <= 2) return pts
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

// ------------------------------------------------------ minimum bounding circle

export type Circle = { center: Pt; r: number }

function circleFrom2(a: Pt, b: Pt): Circle {
  const center: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  return { center, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 }
}

function circleFrom3(a: Pt, b: Pt, c: Pt): Circle | null {
  const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1]
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-12) return null
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
  const center: Pt = [ux, uy]
  return { center, r: Math.hypot(ax - ux, ay - uy) }
}

function inCircle(p: Pt, c: Circle): boolean {
  return Math.hypot(p[0] - c.center[0], p[1] - c.center[1]) <= c.r + 1e-7
}

/** Welzl's algorithm (iterative bounds, randomized). */
export function minimumBoundingCircle(points: Pt[]): Circle | null {
  const pts = [...new Map(points.map((p) => [p[0] + ":" + p[1], p])).values()]
  if (pts.length === 0) return null
  if (pts.length === 1) return { center: pts[0], r: 0 }
  // shuffle
  for (let i = pts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pts[i], pts[j]] = [pts[j], pts[i]]
  }
  let c: Circle = circleFrom2(pts[0], pts[1])
  for (let i = 2; i < pts.length; i++) {
    if (inCircle(pts[i], c)) continue
    // pts[i] on boundary
    c = circleFrom2(pts[0], pts[i])
    for (let j = 1; j < i; j++) {
      if (inCircle(pts[j], c)) continue
      c = circleFrom2(pts[j], pts[i])
      for (let k = 0; k < j; k++) {
        if (inCircle(pts[k], c)) continue
        c = circleFrom3(pts[k], pts[j], pts[i]) ?? c
      }
    }
  }
  return c
}

export function circlePolygon(c: Circle, n = 72): Pt[] {
  const ring: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    ring.push([c.center[0] + Math.cos(a) * c.r, c.center[1] + Math.sin(a) * c.r])
  }
  return ring
}

// --------------------------------------------------------------- simplification

/** Douglas-Peucker on an open polyline. */
export function simplifyDP(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2 || tol <= 0) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    if (e - s < 2) continue
    let maxD = -1
    let idx = -1
    for (let i = s + 1; i < e; i++) {
      const { d } = pointSegDist(pts[i], pts[s], pts[e])
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (maxD > tol) {
      keep[idx] = 1
      stack.push([s, idx], [idx, e])
    }
  }
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i])
  return out
}

/** DP for an unclosed ring: keeps closure and at least a triangle. */
export function simplifyRingDP(ring: Pt[], tol: number): Pt[] {
  if (ring.length <= 4 || tol <= 0) return ring.slice()
  const closed = [...ring, ring[0]]
  let out = simplifyDP(closed, tol)
  out = out.slice(0, -1)
  return out.length >= 3 ? out : ring.slice()
}

function triArea(a: Pt, b: Pt, c: Pt): number {
  return Math.abs(
    (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]),
  ) / 2
}

/** Visvalingam-Whyatt: drop vertices whose effective triangle area < tolArea. */
export function simplifyVW(pts: Pt[], tolArea: number, closed: boolean): Pt[] {
  const minLen = closed ? 3 : 2
  let cur = pts.slice()
  if (cur.length <= minLen || tolArea <= 0) return cur
  for (;;) {
    if (cur.length <= minLen) break
    let minA = Infinity
    let minI = -1
    const n = cur.length
    const from = closed ? 0 : 1
    const to = closed ? n : n - 1
    for (let i = from; i < to; i++) {
      const prev = cur[(i - 1 + n) % n]
      const next = cur[(i + 1) % n]
      const a = triArea(prev, cur[i], next)
      if (a < minA) {
        minA = a
        minI = i
      }
    }
    if (minI < 0 || minA >= tolArea) break
    cur.splice(minI, 1)
  }
  return cur
}

/** Insert vertices so no segment is longer than maxLen. */
export function segmentize(pts: Pt[], maxLen: number, closed: boolean): Pt[] {
  if (maxLen <= 0 || pts.length < 2) return pts.slice()
  const out: Pt[] = []
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    out.push(a)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const parts = Math.ceil(len / maxLen)
    for (let k = 1; k < parts; k++) {
      const t = k / parts
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  if (!closed) out.push(pts[pts.length - 1])
  return out
}

export function removeRepeated(pts: Pt[], tol: number, closed: boolean): Pt[] {
  if (pts.length === 0) return []
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1]
    if (Math.hypot(pts[i][0] - last[0], pts[i][1] - last[1]) > tol) {
      out.push(pts[i])
    }
  }
  if (closed && out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= tol) out.pop()
  }
  return out
}

/** Apply a per-path transform to every linestring and polygon ring. */
export function transformPaths(
  g: Geom,
  fn: (pts: Pt[], closed: boolean) => Pt[],
): Geom {
  switch (g.type) {
    case "LineString":
      return { type: "LineString", coordinates: fn(g.coordinates, false) }
    case "MultiLineString":
      return {
        type: "MultiLineString",
        coordinates: g.coordinates.map((l) => fn(l, false)),
      }
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: g.coordinates.map((r) => fn(r, true)),
      }
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: g.coordinates.map((p) => p.map((r) => fn(r, true))),
      }
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: g.geometries.map((x) => transformPaths(x, fn)),
      }
    default:
      return cloneGeom(g)
  }
}

// ------------------------------------------------------------------------ snap

export type SnapMove = { from: Pt; to: Pt }

/** Snap vertices of `a` to vertices/edges of `b` within tolerance. */
export function snapGeom(
  a: Geom,
  b: Geom,
  tol: number,
): { geom: Geom; moves: SnapMove[] } {
  const targets = verticesOf(b)
  const segs: Array<[Pt, Pt]> = []
  for (const line of linesOf(b)) {
    for (let i = 0; i < line.length - 1; i++) segs.push([line[i], line[i + 1]])
  }
  for (const poly of (b.type === "Polygon" || b.type === "MultiPolygon"
    ? require_polygons(b)
    : [])) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        segs.push([ring[i], ring[(i + 1) % ring.length]])
      }
    }
  }
  const moves: SnapMove[] = []
  const snapPt = (p: Pt): Pt => {
    let best: Pt | null = null
    let bestD = tol
    for (const t of targets) {
      const d = Math.hypot(p[0] - t[0], p[1] - t[1])
      if (d <= bestD) {
        bestD = d
        best = t
      }
    }
    if (!best) {
      let segD = tol
      for (const [s1, s2] of segs) {
        const r = pointSegDist(p, s1, s2)
        if (r.d <= segD) {
          segD = r.d
          best = r.cp
        }
      }
    }
    if (best && (best[0] !== p[0] || best[1] !== p[1])) {
      moves.push({ from: p, to: best })
      return [best[0], best[1]]
    }
    return p
  }
  const geom = mapAllCoords(a, snapPt)
  return { geom, moves }
}

function require_polygons(g: Geom): Pt[][][] {
  switch (g.type) {
    case "Polygon":
      return [g.coordinates]
    case "MultiPolygon":
      return g.coordinates
    case "GeometryCollection":
      return g.geometries.flatMap((x) => require_polygons(x))
    default:
      return []
  }
}

function mapAllCoords(g: Geom, fn: (p: Pt) => Pt): Geom {
  const m1 = (pts: Pt[]) => pts.map(fn)
  switch (g.type) {
    case "Point":
      return { type: "Point", coordinates: fn(g.coordinates) }
    case "MultiPoint":
      return { type: "MultiPoint", coordinates: m1(g.coordinates) }
    case "LineString":
      return { type: "LineString", coordinates: m1(g.coordinates) }
    case "MultiLineString":
      return { type: "MultiLineString", coordinates: g.coordinates.map(m1) }
    case "Polygon":
      return { type: "Polygon", coordinates: g.coordinates.map(m1) }
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: g.coordinates.map((p) => p.map(m1)),
      }
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: g.geometries.map((x) => mapAllCoords(x, fn)),
      }
  }
}

// ------------------------------------------------------------------ validation

function segIntersect(p1: Pt, p2: Pt, q1: Pt, q2: Pt): Pt | null {
  const rx = p2[0] - p1[0]
  const ry = p2[1] - p1[1]
  const sx = q2[0] - q1[0]
  const sy = q2[1] - q1[1]
  const denom = rx * sy - ry * sx
  if (Math.abs(denom) < 1e-12) return null
  const t = ((q1[0] - p1[0]) * sy - (q1[1] - p1[1]) * sx) / denom
  const u = ((q1[0] - p1[0]) * ry - (q1[1] - p1[1]) * rx) / denom
  const eps = 1e-9
  if (t > eps && t < 1 - eps && u > eps && u < 1 - eps) {
    return [p1[0] + t * rx, p1[1] + t * ry]
  }
  return null
}

function pathSelfIntersections(pts: Pt[], closed: boolean): Pt[] {
  const segs: Array<[Pt, Pt]> = []
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) segs.push([pts[i], pts[(i + 1) % pts.length]])
  const hits: Pt[] = []
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 2; j < segs.length; j++) {
      if (closed && i === 0 && j === segs.length - 1) continue // adjacent via wrap
      const hit = segIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1])
      if (hit) hits.push(hit)
    }
  }
  return hits
}

/** Self-intersection points of all rings and lines. */
export function selfIntersections(g: Geom): Pt[] {
  const hits: Pt[] = []
  for (const line of linesOf(g)) hits.push(...pathSelfIntersections(line, false))
  for (const poly of require_polygons(g)) {
    for (const ring of poly) hits.push(...pathSelfIntersections(ring, true))
  }
  return hits
}

export function isClosedGeom(g: Geom): boolean {
  const lines = linesOf(g)
  if (lines.length === 0) return true // points & polygons: closed by definition here
  return lines.every((line) => {
    if (line.length < 2) return false
    const a = line[0]
    const b = line[line.length - 1]
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9
  })
}
