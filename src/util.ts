// Canvas constants, theme palettes, and coordinate helpers.

import { Geom, Pt } from "./geo/types"
import { bboxOf } from "./geo/measure"

export const CANVAS_W = 800
export const CANVAS_H = 600

export type Palette = {
  a: string
  b: string
  result: string
  accent: string
  bad: string
  ghost: string
  canvas: string
  grid: string
  label: string
}

export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    a: "#2783DE",
    b: "#D5803B",
    result: "#46A171",
    accent: "#BF8EDA",
    bad: "#E56458",
    ghost: "#9B9891",
    canvas: "#FFFFFF",
    grid: "#ECEAE7",
    label: "#75726D",
  },
  dark: {
    a: "#5E9FE8",
    b: "#DE9255",
    result: "#72BC8F",
    accent: "#BF8EDA",
    bad: "#E97366",
    ghost: "#7A7A7A",
    canvas: "#191919",
    grid: "#2A2A2A",
    label: "#9B9891",
  },
}

/** Apply a coordinate mapping to every position of a geometry. */
export function mapCoordsGeom(g: Geom, f: (p: Pt) => Pt): Geom {
  switch (g.type) {
    case "Point":
      return { type: "Point", coordinates: f(g.coordinates) }
    case "MultiPoint":
      return { type: "MultiPoint", coordinates: g.coordinates.map(f) }
    case "LineString":
      return { type: "LineString", coordinates: g.coordinates.map(f) }
    case "MultiLineString":
      return {
        type: "MultiLineString",
        coordinates: g.coordinates.map((l) => l.map(f)),
      }
    case "Polygon":
      return { type: "Polygon", coordinates: g.coordinates.map((r) => r.map(f)) }
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: g.coordinates.map((p) => p.map((r) => r.map(f))),
      }
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: g.geometries.map((x) => mapCoordsGeom(x, f)),
      }
  }
}

/**
 * Scale + center an imported geometry to fit the canvas.
 * Flips the y axis (GeoJSON y grows up, screen y grows down).
 */
export function fitToCanvas(g: Geom, margin = 70): Geom {
  const bb = bboxOf(g)
  if (!bb) return g
  const w = bb[2] - bb[0]
  const h = bb[3] - bb[1]
  if (w < 1e-9 && h < 1e-9) {
    return mapCoordsGeom(g, () => [CANVAS_W / 2, CANVAS_H / 2])
  }
  const availW = CANVAS_W - margin * 2
  const availH = CANVAS_H - margin * 2
  const s = Math.min(availW / Math.max(w, 1e-9), availH / Math.max(h, 1e-9))
  const offx = (CANVAS_W - w * s) / 2
  const offy = (CANVAS_H - h * s) / 2
  return mapCoordsGeom(g, (p) => [
    (p[0] - bb[0]) * s + offx,
    CANVAS_H - ((p[1] - bb[1]) * s + offy),
  ])
}
