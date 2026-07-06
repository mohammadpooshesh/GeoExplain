// Download helpers: GeoJSON, SVG, and PNG snapshots of the canvas.

import { Geom, toGeoJSON } from "./geo/types"

function download(name: string, mime: string, data: string | Blob): void {
  const blob =
    typeof data === "string" ? new Blob([data], { type: mime }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function exportGeoJSON(
  a: Geom | null,
  b: Geom | null,
  result: Geom | null,
): void {
  const features: Array<Record<string, unknown>> = []
  const add = (g: Geom | null, role: string): void => {
    if (!g) return
    features.push({
      type: "Feature",
      properties: { role },
      geometry: toGeoJSON(g),
    })
  }
  add(a, "A")
  add(b, "B")
  add(result, "result")
  const fc = { type: "FeatureCollection", features }
  download(
    "geoexplain.geojson",
    "application/geo+json",
    JSON.stringify(fc, null, 2),
  )
}

function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
  clone.setAttribute("width", "800")
  clone.setAttribute("height", "600")
  return new XMLSerializer().serializeToString(clone)
}

export function exportSVG(svg: SVGSVGElement): void {
  download("geoexplain.svg", "image/svg+xml", serializeSvg(svg))
}

export function exportPNG(svg: SVGSVGElement): void {
  const xml = serializeSvg(svg)
  const url = URL.createObjectURL(
    new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
  )
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement("canvas")
    canvas.width = 1600
    canvas.height = 1200
    const ctx = canvas.getContext("2d")
    if (ctx) {
      ctx.drawImage(img, 0, 0, 1600, 1200)
      canvas.toBlob((blob) => {
        if (blob) download("geoexplain.png", "image/png", blob)
      })
    }
    URL.revokeObjectURL(url)
  }
  img.onerror = () => URL.revokeObjectURL(url)
  img.src = url
}
