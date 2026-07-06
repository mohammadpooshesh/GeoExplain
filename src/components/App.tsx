import { useEffect, useMemo, useRef } from "react"
import { Frame, Layer, RunOutput, findFn } from "../catalog"
import { actions, currentParams, getState, useStore } from "../store"
import { CanvasView } from "./CanvasView"
import { CodeTabs } from "./CodeTabs"
import { FunctionList } from "./FunctionList"
import { GeoJsonDialog } from "./GeoJsonDialog"
import { Inspector } from "./Inspector"
import { Timeline } from "./Timeline"
import { Toolbar } from "./Toolbar"

export function App() {
  const s = useStore()
  const fn = findFn(s.fnName)
  const params = currentParams(s)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const run = useMemo<RunOutput | null>(() => {
    if (!s.a) return null
    try {
      return fn.run(s.a, s.b, params)
    } catch (err) {
      return {
        ok: false,
        message: "Internal error: " + String(err),
        result: null,
        frames: [],
      }
    }
  }, [s.a, s.b, fn, params])

  const frames: Frame[] = run ? run.frames : []
  const frameIdx = frames.length > 0 ? Math.min(s.frame, frames.length - 1) : 0

  // step-by-step animation driver
  useEffect(() => {
    if (!s.playing || frames.length < 2) return
    const t = setInterval(() => {
      const st = getState()
      if (st.frame >= frames.length - 1) actions.setPlaying(false)
      else actions.setFrame(st.frame + 1, false)
    }, 950)
    return () => clearInterval(t)
  }, [s.playing, frames.length])

  // show B as a ghost when the current function ignores it
  const ghosts = useMemo<Layer[]>(() => {
    if (!fn.needsB && s.b) {
      return [{ geom: s.b, role: "ghost", opacity: 0.4, dashed: true }]
    }
    return []
  }, [fn, s.b])

  const fallback: Layer[] = []
  if (frames.length === 0) {
    if (s.a) fallback.push({ geom: s.a, role: "a", showVertices: true })
    if (s.b) fallback.push({ geom: s.b, role: "b", showVertices: true })
  }
  const current = frames.length > 0 ? frames[frameIdx].layers : fallback
  const layers = [...ghosts, ...current]
  const beforeLayers =
    frames.length > 0 ? [...ghosts, ...frames[0].layers] : layers

  return (
    <div className="app">
      <Toolbar svgRef={svgRef} run={run} />
      <div className="main">
        <FunctionList />
        <div className="center">
          <CanvasView layers={layers} beforeLayers={beforeLayers} svgRef={svgRef} />
          <Timeline frames={frames} frameIdx={frameIdx} />
        </div>
        <Inspector fn={fn} run={run} />
      </div>
      <CodeTabs snippets={fn.code(params)} />
      {s.dialog === "geojson" ? <GeoJsonDialog /> : null}
    </div>
  )
}
