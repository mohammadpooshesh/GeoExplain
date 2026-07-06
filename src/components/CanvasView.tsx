import {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  useEffect,
  useState,
} from "react"
import { Layer } from "../catalog"
import { removeRepeated } from "../geo/algorithms"
import { insidePolygonRings, pointSegDist } from "../geo/measure"
import {
  Geom,
  Pt,
  fromGeoJSON,
  linesOf,
  pointsOf,
  polygonsOf,
  segmentsOf,
  translateGeom,
  verticesOf,
} from "../geo/types"
import { Slot, actions, getState, useStore } from "../store"
import { CANVAS_H, CANVAS_W, PALETTES, Palette, fitToCanvas } from "../util"

function fmtN(n: number): string {
  return String(Math.round(n * 10) / 10)
}

function ringPath(pts: Pt[]): string {
  if (pts.length < 2) return ""
  let d = "M " + fmtN(pts[0][0]) + " " + fmtN(pts[0][1])
  for (let i = 1; i < pts.length; i++) {
    d += " L " + fmtN(pts[i][0]) + " " + fmtN(pts[i][1])
  }
  return d
}

function polyPath(g: Geom): string {
  let d = ""
  for (const poly of polygonsOf(g)) {
    for (const ring of poly) {
      const p = ringPath(ring)
      if (p) d += p + " Z "
    }
  }
  return d.trim()
}

function linePath(g: Geom): string {
  let d = ""
  for (const line of linesOf(g)) {
    const p = ringPath(line)
    if (p) d += p + " "
  }
  return d.trim()
}

function LayerShape(props: { layer: Layer; pal: Palette }) {
  const { layer, pal } = props
  const color = pal[layer.role]
  const opacity = layer.opacity ?? 1
  const pPath = polyPath(layer.geom)
  const lPath = linePath(layer.geom)
  const lone = pointsOf(layer.geom)
  const strokeW = layer.wide ? 3.5 : 2
  const dash = layer.dashed ? "6 5" : undefined
  const verts = layer.showVertices ? verticesOf(layer.geom) : []
  return (
    <g opacity={opacity}>
      {pPath ? (
        <path
          d={pPath}
          fill={color}
          fillOpacity={0.16}
          fillRule="evenodd"
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={dash}
          strokeLinejoin="round"
        />
      ) : null}
      {lPath ? (
        <path
          d={lPath}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {lone.map((p, i) => (
        <circle key={"p" + i} cx={p[0]} cy={p[1]} r={layer.wide ? 7 : 5} fill={color} />
      ))}
      {verts.map((p, i) => (
        <circle
          key={"v" + i}
          cx={p[0]}
          cy={p[1]}
          r={2.7}
          fill={pal.canvas}
          stroke={color}
          strokeWidth={1.4}
        />
      ))}
    </g>
  )
}

export function CanvasView(props: {
  layers: Layer[]
  beforeLayers: Layer[]
  svgRef: RefObject<SVGSVGElement | null>
}) {
  const s = useStore()
  const pal = PALETTES[s.theme]
  const [draft, setDraft] = useState<Pt[]>([])
  const [split, setSplit] = useState(50)
  const [drag, setDrag] = useState<{ slot: Slot; last: Pt } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDraft([])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    setDraft([])
  }, [s.tool, s.activeSlot])

  const toCanvas = (e: { clientX: number; clientY: number }): Pt => {
    const svg = props.svgRef.current
    if (!svg) return [0, 0]
    const rect = svg.getBoundingClientRect()
    const scale = Math.min(rect.width / CANVAS_W, rect.height / CANVAS_H)
    const ox = rect.left + (rect.width - CANVAS_W * scale) / 2
    const oy = rect.top + (rect.height - CANVAS_H * scale) / 2
    return [(e.clientX - ox) / scale, (e.clientY - oy) / scale]
  }

  const hitSlot = (p: Pt): Slot | null => {
    const st = getState()
    const first: { slot: Slot; g: Geom | null } =
      st.activeSlot === "a" ? { slot: "a", g: st.a } : { slot: "b", g: st.b }
    const second: { slot: Slot; g: Geom | null } =
      st.activeSlot === "a" ? { slot: "b", g: st.b } : { slot: "a", g: st.a }
    for (const item of [first, second]) {
      if (!item.g) continue
      for (const poly of polygonsOf(item.g)) {
        if (insidePolygonRings(p[0], p[1], poly)) return item.slot
      }
      for (const seg of segmentsOf(item.g)) {
        if (pointSegDist(p, seg[0], seg[1]).d < 9) return item.slot
      }
      for (const v of verticesOf(item.g)) {
        if (Math.hypot(p[0] - v[0], p[1] - v[1]) < 9) return item.slot
      }
    }
    return null
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (s.tool !== "select") return
    const p = toCanvas(e)
    const slot = hitSlot(p)
    if (!slot) return
    actions.checkpoint()
    setDrag({ slot, last: p })
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag) return
    const p = toCanvas(e)
    const dx = p[0] - drag.last[0]
    const dy = p[1] - drag.last[1]
    if (dx === 0 && dy === 0) return
    const st = getState()
    const g = drag.slot === "a" ? st.a : st.b
    if (g) actions.setGeom(drag.slot, translateGeom(g, dx, dy), false)
    setDrag({ slot: drag.slot, last: p })
  }

  const onPointerUp = () => setDrag(null)

  const onClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    const p = toCanvas(e)
    if (s.tool === "point") {
      actions.setGeom(s.activeSlot, { type: "Point", coordinates: p })
    } else if (s.tool === "line" || s.tool === "polygon") {
      setDraft((d) => [...d, p])
    }
  }

  const finishDraft = () => {
    const tool = s.tool
    const pts = removeRepeated(draft, 3, tool === "polygon")
    setDraft([])
    if (tool === "line" && pts.length >= 2) {
      actions.setGeom(s.activeSlot, { type: "LineString", coordinates: pts })
    } else if (tool === "polygon" && pts.length >= 3) {
      actions.setGeom(s.activeSlot, { type: "Polygon", coordinates: [pts] })
    }
  }

  const onDoubleClick = () => {
    if (s.tool === "line" || s.tool === "polygon") finishDraft()
  }

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files ? e.dataTransfer.files[0] : null
    if (!file) return
    file.text().then((t) => {
      try {
        const g = fromGeoJSON(JSON.parse(t))
        if (g) actions.setGeom(getState().activeSlot, fitToCanvas(g))
      } catch (err) {
        // invalid drop content: ignore
      }
    })
  }

  let hintText = ""
  if (s.tool === "line" || s.tool === "polygon") {
    hintText =
      draft.length === 0
        ? "Click to add vertices to " +
          s.activeSlot.toUpperCase() +
          " — double-click to finish, Esc to cancel"
        : draft.length + " vertices — double-click to finish, Esc to cancel"
  } else if (s.tool === "point") {
    hintText = "Click to place a point into " + s.activeSlot.toUpperCase()
  } else if (!s.a) {
    hintText = "Draw with the tools above, load the sample, or drop a GeoJSON file here"
  }

  const splitX = (split / 100) * CANVAS_W
  const drawCursor = s.tool !== "select"
  const draftClose = s.tool === "polygon" && draft.length > 2 ? " Z" : ""

  return (
    <div className="canvas-wrap" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg
        ref={props.svgRef}
        className={"canvas-svg" + (drawCursor ? " draw" : "")}
        viewBox={"0 0 " + CANVAS_W + " " + CANVAS_H}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <pattern id="grid" width={40} height={40} patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={pal.grid} strokeWidth={1} />
          </pattern>
          <clipPath id="clip-left">
            <rect x={0} y={0} width={splitX} height={CANVAS_H} />
          </clipPath>
          <clipPath id="clip-right">
            <rect x={splitX} y={0} width={CANVAS_W - splitX} height={CANVAS_H} />
          </clipPath>
        </defs>
        <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill={pal.canvas} />
        <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="url(#grid)" />
        {s.compare ? (
          <g>
            <g clipPath="url(#clip-left)">
              {props.beforeLayers.map((l, i) => (
                <LayerShape key={"b" + i} layer={l} pal={pal} />
              ))}
            </g>
            <g clipPath="url(#clip-right)">
              {props.layers.map((l, i) => (
                <LayerShape key={"a" + i} layer={l} pal={pal} />
              ))}
            </g>
            <line
              x1={splitX}
              y1={0}
              x2={splitX}
              y2={CANVAS_H}
              stroke={pal.label}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <text x={12} y={24} fill={pal.label} fontSize={12}>
              Before
            </text>
            <text x={CANVAS_W - 12} y={24} fill={pal.label} fontSize={12} textAnchor="end">
              After
            </text>
          </g>
        ) : (
          <g>
            {props.layers.map((l, i) => (
              <LayerShape key={i} layer={l} pal={pal} />
            ))}
          </g>
        )}
        {draft.length > 0 ? (
          <g>
            <path
              d={ringPath(draft) + draftClose}
              fill="none"
              stroke={pal.accent}
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            {draft.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={pal.accent} />
            ))}
          </g>
        ) : null}
      </svg>
      {hintText ? <div className="canvas-hint">{hintText}</div> : null}
      {s.compare ? (
        <div className="compare-bar">
          <span>Before</span>
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
          />
          <span>After</span>
        </div>
      ) : null}
    </div>
  )
}
