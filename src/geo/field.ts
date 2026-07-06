// Signed-distance-field engine: buffer, boolean overlays, split, make-valid,
// concave hull. Results are extracted with marching squares (linear
// interpolation) and lightly simplified, which yields smooth, watertight
// approximations of the classic GEOS operations — ideal for visualization.

import {
  Geom,
  MultiPolygonG,
  PolygonG,
  Pt,
  geomKind,
  pointsOf,
  polygonsOf,
  segmentsOf,
  verticesOf,
} from "./types"
import { bboxOf, bboxUnion, insidePolygonRings, ringSignedArea } from "./measure"
import { simplifyRingDP } from "./algorithms"

export type SDF = (x: number, y: number) => number

export const DEFAULT_RES = 180

/** Build a fast signed distance function for a geometry. */
export function makeSDF(g: Geom): SDF {
  const segs = segmentsOf(g)
  const n = segs.length
  const ax = new Float64Array(n)
  const ay = new Float64Array(n)
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  const l2 = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    ax[i] = segs[i][0][0]
    ay[i] = segs[i][0][1]
    dx[i] = segs[i][1][0] - ax[i]
    dy[i] = segs[i][1][1] - ay[i]
    l2[i] = dx[i] * dx[i] + dy[i] * dy[i]
  }
  const lone = pointsOf(g)
  const polys = polygonsOf(g)
  return (x: number, y: number): number => {
    let d2 = Infinity
    for (let i = 0; i < n; i++) {
      let t = l2[i] > 0 ? ((x - ax[i]) * dx[i] + (y - ay[i]) * dy[i]) / l2[i] : 0
      if (t < 0) t = 0
      else if (t > 1) t = 1
      const ex = x - (ax[i] + t * dx[i])
      const ey = y - (ay[i] + t * dy[i])
      const dd = ex * ex + ey * ey
      if (dd < d2) d2 = dd
    }
    for (const p of lone) {
      const ex = x - p[0]
      const ey = y - p[1]
      const dd = ex * ex + ey * ey
      if (dd < d2) d2 = dd
    }
    let d = Math.sqrt(d2)
    if (polys.length > 0) {
      for (const poly of polys) {
        if (insidePolygonRings(x, y, poly)) {
          d = -d
          break
        }
      }
    }
    return d
  }
}

export type Field = {
  nx: number
  ny: number
  x0: number
  y0: number
  step: number
  v: Float64Array
}

export function sampleField(
  sdf: SDF,
  bbox: [number, number, number, number],
  res: number,
): Field {
  const [minx, miny, maxx, maxy] = bbox
  const w = Math.max(maxx - minx, 1e-6)
  const h = Math.max(maxy - miny, 1e-6)
  const step = Math.max(w, h) / res
  const nx = Math.max(8, Math.ceil(w / step) + 2)
  const ny = Math.max(8, Math.ceil(h / step) + 2)
  const v = new Float64Array(nx * ny)
  for (let j = 0; j < ny; j++) {
    const y = miny + j * step
    for (let i = 0; i < nx; i++) {
      v[j * nx + i] = sdf(minx + i * step, y)
    }
  }
  return { nx, ny, x0: minx, y0: miny, step, v }
}

export function combineFields(
  a: Field,
  b: Field,
  op: "union" | "intersection" | "difference" | "symdifference",
): Field {
  const v = new Float64Array(a.v.length)
  for (let i = 0; i < v.length; i++) {
    const fa = a.v[i]
    const fb = b.v[i]
    switch (op) {
      case "union":
        v[i] = Math.min(fa, fb)
        break
      case "intersection":
        v[i] = Math.max(fa, fb)
        break
      case "difference":
        v[i] = Math.max(fa, -fb)
        break
      case "symdifference":
        v[i] = Math.min(Math.max(fa, -fb), Math.max(fb, -fa))
        break
    }
  }
  return { ...a, v }
}

// ------------------------------------------------------------ marching squares

/** Extract iso-contour rings (value == level) as unclosed rings. */
export function contourRings(f: Field, level: number): Pt[][] {
  const { nx, ny, step, x0, y0 } = f
  const guard = level + step * 2
  const val = (i: number, j: number): number => {
    let raw = f.v[j * nx + i]
    if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) {
      // force the border outside so every contour closes
      if (raw <= level) raw = guard
    }
    let d = raw - level
    if (d === 0) d = 1e-12
    return d
  }
  const segs: Array<[Pt, Pt]> = []
  const interp = (
    x1: number,
    y1: number,
    v1: number,
    x2: number,
    y2: number,
    v2: number,
  ): Pt => {
    const t = v1 / (v1 - v2)
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]
  }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const tl = val(i, j)
      const tr = val(i + 1, j)
      const br = val(i + 1, j + 1)
      const bl = val(i, j + 1)
      const idx =
        (tl < 0 ? 8 : 0) | (tr < 0 ? 4 : 0) | (br < 0 ? 2 : 0) | (bl < 0 ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      const xL = x0 + i * step
      const xR = x0 + (i + 1) * step
      const yT = y0 + j * step
      const yB = y0 + (j + 1) * step
      const T = (): Pt => interp(xL, yT, tl, xR, yT, tr)
      const R = (): Pt => interp(xR, yT, tr, xR, yB, br)
      const B = (): Pt => interp(xL, yB, bl, xR, yB, br)
      const L = (): Pt => interp(xL, yT, tl, xL, yB, bl)
      switch (idx) {
        case 1:
          segs.push([L(), B()])
          break
        case 2:
          segs.push([B(), R()])
          break
        case 3:
          segs.push([L(), R()])
          break
        case 4:
          segs.push([T(), R()])
          break
        case 5: {
          const center = (tl + tr + br + bl) / 4
          if (center < 0) {
            segs.push([T(), L()], [B(), R()])
          } else {
            segs.push([T(), R()], [L(), B()])
          }
          break
        }
        case 6:
          segs.push([T(), B()])
          break
        case 7:
          segs.push([T(), L()])
          break
        case 8:
          segs.push([T(), L()])
          break
        case 9:
          segs.push([T(), B()])
          break
        case 10: {
          const center = (tl + tr + br + bl) / 4
          if (center < 0) {
            segs.push([T(), R()], [L(), B()])
          } else {
            segs.push([T(), L()], [B(), R()])
          }
          break
        }
        case 11:
          segs.push([T(), R()])
          break
        case 12:
          segs.push([L(), R()])
          break
        case 13:
          segs.push([B(), R()])
          break
        case 14:
          segs.push([L(), B()])
          break
      }
    }
  }
  return stitchSegments(segs, step)
}

function stitchSegments(segs: Array<[Pt, Pt]>, step: number): Pt[][] {
  const key = (p: Pt) =>
    Math.round(p[0] * 1e5) + ":" + Math.round(p[1] * 1e5)
  const byEnd = new Map<string, number[]>()
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p)
      const list = byEnd.get(k)
      if (list) list.push(i)
      else byEnd.set(k, [i])
    }
  })
  const used = new Uint8Array(segs.length)
  const rings: Pt[][] = []
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue
    used[s] = 1
    const ring: Pt[] = [segs[s][0], segs[s][1]]
    const startKey = key(ring[0])
    for (let guard = 0; guard < segs.length + 4; guard++) {
      const curKey = key(ring[ring.length - 1])
      if (curKey === startKey) break
      const candidates = byEnd.get(curKey) ?? []
      let advanced = false
      for (const ci of candidates) {
        if (used[ci]) continue
        used[ci] = 1
        const [p, q] = segs[ci]
        ring.push(key(p) === curKey ? q : p)
        advanced = true
        break
      }
      if (!advanced) break
    }
    // closed?
    if (ring.length >= 4 && key(ring[ring.length - 1]) === key(ring[0])) {
      ring.pop()
      const simplified = simplifyRingDP(ring, step * 0.3)
      if (
        simplified.length >= 3 &&
        Math.abs(ringSignedArea(simplified)) > step * step * 1.5
      ) {
        rings.push(simplified)
      }
    }
  }
  return rings
}

// ------------------------------------------------------------- ring assembling

export function assemblePolygons(rings: Pt[][]): Geom | null {
  if (rings.length === 0) return null
  const items = rings
    .map((r) => ({ r, area: Math.abs(ringSignedArea(r)) }))
    .sort((a, b) => b.area - a.area)
  type PolyAcc = { outer: Pt[]; holes: Pt[][]; outerArea: number }
  const polys: PolyAcc[] = []
  for (const item of items) {
    const rep = item.r[0]
    // count how many other rings contain this ring's representative point
    let depth = 0
    for (const other of items) {
      if (other === item) continue
      if (other.area <= item.area) continue
      if (insidePolygonRings(rep[0], rep[1], [other.r])) depth++
    }
    if (depth % 2 === 0) {
      polys.push({ outer: normalizeRing(item.r, true), holes: [], outerArea: item.area })
    } else {
      // hole: attach to smallest containing outer
      let parent: PolyAcc | null = null
      for (const p of polys) {
        if (p.outerArea > item.area && insidePolygonRings(rep[0], rep[1], [p.outer])) {
          if (!parent || p.outerArea < parent.outerArea) parent = p
        }
      }
      if (parent) parent.holes.push(normalizeRing(item.r, false))
      else polys.push({ outer: normalizeRing(item.r, true), holes: [], outerArea: item.area })
    }
  }
  if (polys.length === 0) return null
  if (polys.length === 1) {
    const p: PolygonG = {
      type: "Polygon",
      coordinates: [polys[0].outer, ...polys[0].holes],
    }
    return p
  }
  const mp: MultiPolygonG = {
    type: "MultiPolygon",
    coordinates: polys.map((p) => [p.outer, ...p.holes]),
  }
  return mp
}

function normalizeRing(ring: Pt[], outer: boolean): Pt[] {
  const positive = ringSignedArea(ring) > 0
  if (outer !== positive) return [...ring].reverse()
  return ring
}

// ---------------------------------------------------------------- operations

function padBbox(
  bbox: [number, number, number, number],
  pad: number,
): [number, number, number, number] {
  return [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad]
}

function diagOf(bbox: [number, number, number, number]): number {
  return Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1])
}

/** ST_Buffer-like operation. Negative distances shrink polygons. */
export function bufferGeom(
  g: Geom,
  distance: number,
  res = DEFAULT_RES,
): Geom | null {
  const bbox = bboxOf(g)
  if (!bbox) return null
  if (distance <= 0 && geomKind(g) !== "polygon") return null
  if (distance === 0 && geomKind(g) !== "polygon") return null
  const pad = Math.max(Math.abs(distance) * 1.2, diagOf(bbox) * 0.03) + 4
  const field = sampleField(makeSDF(g), padBbox(bbox, pad), res)
  const rings = contourRings(field, distance)
  return assemblePolygons(rings)
}

export function booleanOp(
  a: Geom,
  b: Geom,
  op: "union" | "intersection" | "difference" | "symdifference",
  res = DEFAULT_RES,
): Geom | null {
  const bbox = bboxUnion(bboxOf(a), bboxOf(b))
  if (!bbox) return null
  const padded = padBbox(bbox, diagOf(bbox) * 0.04 + 4)
  const fa = sampleField(makeSDF(a), padded, res)
  const fb = sampleField(makeSDF(b), padded, res)
  const combined = combineFields(fa, fb, op)
  return assemblePolygons(contourRings(combined, 0))
}

/** Dissolve a single (multi)geometry: contour of its own SDF at 0. */
export function dissolveGeom(g: Geom, res = DEFAULT_RES): Geom | null {
  const bbox = bboxOf(g)
  if (!bbox) return null
  const padded = padBbox(bbox, diagOf(bbox) * 0.04 + 4)
  const field = sampleField(makeSDF(g), padded, res)
  return assemblePolygons(contourRings(field, 0))
}

/** Split a polygon with a blade line: subtract a hairline corridor. */
export function splitGeom(
  poly: Geom,
  blade: Geom,
  res = DEFAULT_RES,
): Geom | null {
  const bbox = bboxOf(poly)
  if (!bbox || !bboxOf(blade)) return null
  const padded = padBbox(bbox, diagOf(bbox) * 0.04 + 4)
  const fa = sampleField(makeSDF(poly), padded, res)
  const sdfBlade = makeSDF(blade)
  const eps = fa.step * 0.8
  const v = new Float64Array(fa.v.length)
  for (let j = 0; j < fa.ny; j++) {
    const y = fa.y0 + j * fa.step
    for (let i = 0; i < fa.nx; i++) {
      const idx = j * fa.nx + i
      const corridor = eps - Math.abs(sdfBlade(fa.x0 + i * fa.step, y))
      v[idx] = Math.max(fa.v[idx], corridor)
    }
  }
  return assemblePolygons(contourRings({ ...fa, v }, 0))
}

/** Re-extract a self-intersecting polygon with even-odd filling. */
export function makeValidGeom(g: Geom, res = DEFAULT_RES): Geom | null {
  return dissolveGeom(g, res)
}

/** Morphological closing over a set of points -> concave hull approximation. */
export function concaveHullGeom(
  g: Geom,
  radius: number,
  res = DEFAULT_RES,
): Geom | null {
  const pts = verticesOf(g)
  if (pts.length < 3) return null
  const bbox = bboxOf(g)
  if (!bbox) return null
  const cloud: Geom = { type: "MultiPoint", coordinates: pts }
  const pad = radius * 1.3 + diagOf(bbox) * 0.03 + 4
  const f1 = sampleField(makeSDF(cloud), padBbox(bbox, pad), res)
  const dilated = assemblePolygons(contourRings(f1, radius))
  if (!dilated) return null
  const f2 = sampleField(makeSDF(dilated), padBbox(bbox, pad), res)
  const closed = assemblePolygons(contourRings(f2, -radius * 0.92))
  return closed ?? dilated
}

/** Most interior point of a polygon (approximate pole of inaccessibility). */
export function interiorPoint(g: Geom, res = 96): Pt | null {
  const bbox = bboxOf(g)
  if (!bbox) return null
  const field = sampleField(makeSDF(g), padBbox(bbox, 2), res)
  let best = Infinity
  let bi = -1
  for (let i = 0; i < field.v.length; i++) {
    if (field.v[i] < best) {
      best = field.v[i]
      bi = i
    }
  }
  if (bi < 0 || best >= 0) return null
  const j = Math.floor(bi / field.nx)
  const i = bi % field.nx
  return [field.x0 + i * field.step, field.y0 + j * field.step]
}
