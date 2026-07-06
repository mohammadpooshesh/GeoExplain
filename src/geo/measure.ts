// Planar measurements: bbox, area, length, centroid, distances, azimuth.

import { Geom, Pt, linesOf, polygonsOf, segmentsOf, verticesOf } from "./types"

export type BBox = [number, number, number, number]

export function bboxOf(g: Geom): BBox | null {
  const pts = verticesOf(g)
  if (pts.length === 0) return null
  let minx = Infinity
  let miny = Infinity
  let maxx = -Infinity
  let maxy = -Infinity
  for (const p of pts) {
    if (p[0] < minx) minx = p[0]
    if (p[1] < miny) miny = p[1]
    if (p[0] > maxx) maxx = p[0]
    if (p[1] > maxy) maxy = p[1]
  }
  return [minx, miny, maxx, maxy]
}

export function bboxUnion(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b
  if (!b) return a
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.max(a[2], b[2]),
    Math.max(a[3], b[3]),
  ]
}

/** Shoelace signed area of an unclosed ring (positive = counter-clockwise). */
export function ringSignedArea(ring: Pt[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

/** Even-odd point-in-polygon over a set of rings. */
export function insidePolygonRings(x: number, y: number, rings: Pt[][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]
      const hit =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (hit) inside = !inside
    }
  }
  return inside
}

/** Distance from a point to a segment, with the closest point. */
export function pointSegDist(
  p: Pt,
  a: Pt,
  b: Pt,
): { d: number; cp: Pt; t: number } {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const cp: Pt = [a[0] + t * dx, a[1] + t * dy]
  return { d: Math.hypot(p[0] - cp[0], p[1] - cp[1]), cp, t }
}

function pathLength(pts: Pt[], closed: boolean): number {
  let sum = 0
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    sum += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  return sum
}

/** Polygon area: outer rings minus holes. */
export function areaOf(g: Geom): number {
  let total = 0
  for (const poly of polygonsOf(g)) {
    if (poly.length === 0) continue
    let a = Math.abs(ringSignedArea(poly[0]))
    for (let i = 1; i < poly.length; i++) a -= Math.abs(ringSignedArea(poly[i]))
    total += Math.max(0, a)
  }
  return total
}

/** Length of open linestrings. */
export function lengthOf(g: Geom): number {
  let sum = 0
  for (const line of linesOf(g)) sum += pathLength(line, false)
  return sum
}

/** Perimeter of polygon boundaries. */
export function perimeterOf(g: Geom): number {
  let sum = 0
  for (const poly of polygonsOf(g)) {
    for (const ring of poly) sum += pathLength(ring, true)
  }
  return sum
}

/** Area-weighted centroid for polygons; vertex average otherwise. */
export function centroidOf(g: Geom): Pt | null {
  const polys = polygonsOf(g)
  if (polys.length > 0) {
    let cx = 0
    let cy = 0
    let aw = 0
    for (const poly of polys) {
      for (let r = 0; r < poly.length; r++) {
        const ring = poly[r]
        let sa = 0
        let sx = 0
        let sy = 0
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i]
          const q = ring[(i + 1) % ring.length]
          const cross = p[0] * q[1] - q[0] * p[1]
          sa += cross
          sx += (p[0] + q[0]) * cross
          sy += (p[1] + q[1]) * cross
        }
        sa = sa / 2
        if (Math.abs(sa) < 1e-12) continue
        const sign = r === 0 ? 1 : -1
        const w = Math.abs(sa) * sign
        cx += (sx / (6 * sa)) * w
        cy += (sy / (6 * sa)) * w
        aw += w
      }
    }
    if (Math.abs(aw) > 1e-12) return [cx / aw, cy / aw]
  }
  const pts = verticesOf(g)
  if (pts.length === 0) return null
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
  }
  return [x / pts.length, y / pts.length]
}

export type PtPair = { p: Pt; q: Pt; d: number }

/** Approximate minimum distance between two geometries (planar). */
export function closestPair(a: Geom, b: Geom): PtPair | null {
  const va = verticesOf(a)
  const vb = verticesOf(b)
  if (va.length === 0 || vb.length === 0) return null
  const segA = segmentsOf(a)
  const segB = segmentsOf(b)
  let best: PtPair = { p: va[0], q: vb[0], d: Infinity }
  for (const p of va) {
    if (segB.length > 0) {
      for (const [s1, s2] of segB) {
        const r = pointSegDist(p, s1, s2)
        if (r.d < best.d) best = { p, q: r.cp, d: r.d }
      }
    } else {
      for (const q of vb) {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1])
        if (d < best.d) best = { p, q, d }
      }
    }
  }
  for (const q of vb) {
    if (segA.length > 0) {
      for (const [s1, s2] of segA) {
        const r = pointSegDist(q, s1, s2)
        if (r.d < best.d) best = { p: r.cp, q, d: r.d }
      }
    }
  }
  for (const poly of polygonsOf(b)) {
    if (insidePolygonRings(va[0][0], va[0][1], poly)) {
      return { p: va[0], q: va[0], d: 0 }
    }
  }
  for (const poly of polygonsOf(a)) {
    if (insidePolygonRings(vb[0][0], vb[0][1], poly)) {
      return { p: vb[0], q: vb[0], d: 0 }
    }
  }
  return best
}

/** Maximum vertex-to-vertex distance between two geometries. */
export function farthestPair(a: Geom, b: Geom): PtPair | null {
  const va = verticesOf(a)
  const vb = verticesOf(b)
  if (va.length === 0 || vb.length === 0) return null
  let best: PtPair = { p: va[0], q: vb[0], d: -1 }
  for (const p of va) {
    for (const q of vb) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (d > best.d) best = { p, q, d }
    }
  }
  return best
}

/** Azimuth in degrees, clockwise from "north" (negative y on screen). */
export function azimuthDeg(a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = a[1] - b[1] // screen y grows downward; north is up
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI
  return (deg + 360) % 360
}

export function vertexCountOf(g: Geom): number {
  return verticesOf(g).length
}

export function segmentCountOf(g: Geom): number {
  return segmentsOf(g).length
}

export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return String(n)
  const r = Math.round(n * 10 ** digits) / 10 ** digits
  return r.toLocaleString("en-US", { maximumFractionDigits: digits })
}
