import { RefObject } from "react"
import { RunOutput } from "../catalog"
import { exportGeoJSON, exportPNG, exportSVG } from "../export"
import { Tool, actions, useStore } from "../store"

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "select", label: "Select" },
  { id: "point", label: "Point" },
  { id: "line", label: "Line" },
  { id: "polygon", label: "Polygon" },
]

export function Toolbar(props: {
  svgRef: RefObject<SVGSVGElement | null>
  run: RunOutput | null
}) {
  const s = useStore()
  const canUndo = s.undoStack.length > 0
  const canRedo = s.redoStack.length > 0

  const toggleTheme = () =>
    actions.setTheme(s.theme === "dark" ? "light" : "dark")

  const doExportSVG = () => {
    if (props.svgRef.current) exportSVG(props.svgRef.current)
  }

  const doExportPNG = () => {
    if (props.svgRef.current) exportPNG(props.svgRef.current)
  }

  return (
    <div className="toolbar">
      <div className="brand">
        <span className="brand-name">GeoExplain</span>
        <span className="brand-tag">see what your geometry is doing</span>
      </div>

      <div className="tb-group" title="Drawing tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={"tb-btn" + (s.tool === t.id ? " active" : "")}
            onClick={() => actions.setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="tb-group" title="Which geometry drawing edits">
        <button
          className={"tb-btn slot-a" + (s.activeSlot === "a" ? " active" : "")}
          onClick={() => actions.setActiveSlot("a")}
          title="Draw into geometry A"
        >
          A
        </button>
        <button
          className={"tb-btn slot-b" + (s.activeSlot === "b" ? " active" : "")}
          onClick={() => actions.setActiveSlot("b")}
          title="Draw into geometry B"
        >
          B
        </button>
      </div>

      <div className="tb-group">
        <button className="tb-btn" disabled={!canUndo} onClick={actions.undo} title="Undo">
          ↩ Undo
        </button>
        <button className="tb-btn" disabled={!canRedo} onClick={actions.redo} title="Redo">
          ↪ Redo
        </button>
      </div>

      <div className="tb-group">
        <button className="tb-btn" onClick={actions.loadSample} title="Load sample geometry">
          Sample
        </button>
        <button className="tb-btn" disabled={!s.a && !s.b} onClick={actions.clearAll} title="Clear all geometry">
          Clear
        </button>
        <button className="tb-btn" onClick={() => actions.setDialog("geojson")} title="Import GeoJSON">
          Import
        </button>
      </div>

      <div className="tb-spacer" />

      <div className="tb-group" title="Export">
        <button
          className="tb-btn"
          disabled={!s.a}
          onClick={() => exportGeoJSON(s.a, s.b, props.run ? props.run.result : null)}
        >
          GeoJSON
        </button>
        <button className="tb-btn" onClick={doExportSVG}>
          SVG
        </button>
        <button className="tb-btn" onClick={doExportPNG}>
          PNG
        </button>
      </div>

      <div className="tb-group">
        <button
          className={"tb-btn" + (s.compare ? " active" : "")}
          onClick={() => actions.setCompare(!s.compare)}
          title="Before / after slider"
        >
          Compare
        </button>
        <button className="tb-btn" onClick={toggleTheme} title="Toggle theme">
          {s.theme === "dark" ? "Light" : "Dark"}
        </button>
      </div>
    </div>
  )
}
