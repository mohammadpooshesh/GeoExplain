import { useState } from "react"
import { fromGeoJSON } from "../geo/types"
import { Slot, actions, useStore } from "../store"
import { fitToCanvas } from "../util"

export function GeoJsonDialog() {
  const s = useStore()
  const [text, setText] = useState("")
  const [slot, setSlot] = useState<Slot>(s.activeSlot)
  const [fit, setFit] = useState(true)
  const [error, setError] = useState("")

  const close = () => actions.setDialog(null)

  const load = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      setError("Invalid JSON: " + String(err))
      return
    }
    const geom = fromGeoJSON(parsed)
    if (!geom) {
      setError("No usable geometry found in this GeoJSON.")
      return
    }
    actions.setGeom(slot, fit ? fitToCanvas(geom) : geom)
    close()
  }

  const onFile = (file: File | null) => {
    if (!file) return
    file
      .text()
      .then((t) => {
        setText(t)
        setError("")
      })
      .catch(() => setError("Could not read the file."))
  }

  const onTextChange = (v: string) => {
    setText(v)
    setError("")
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">Import GeoJSON</h3>
        <textarea
          placeholder="Paste GeoJSON here (geometry, Feature, or FeatureCollection)…"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
        />
        <div className="dialog-row">
          <input
            type="file"
            accept=".json,.geojson,application/geo+json,application/json"
            onChange={(e) => onFile(e.target.files ? e.target.files[0] : null)}
          />
        </div>
        <div className="dialog-row">
          <span className="muted">Load into:</span>
          <label>
            <input type="radio" checked={slot === "a"} onChange={() => setSlot("a")} /> A
          </label>
          <label>
            <input type="radio" checked={slot === "b"} onChange={() => setSlot("b")} /> B
          </label>
          <label>
            <input
              type="checkbox"
              checked={fit}
              onChange={(e) => setFit(e.target.checked)}
            />
            Fit to canvas
          </label>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="dialog-actions">
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" onClick={load} disabled={text.trim() === ""}>
            Load
          </button>
        </div>
      </div>
    </div>
  )
}
