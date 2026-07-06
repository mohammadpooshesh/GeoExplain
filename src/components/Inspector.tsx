import { FnDef, RunOutput } from "../catalog"
import {
  areaOf,
  bboxOf,
  centroidOf,
  fmt,
  lengthOf,
  perimeterOf,
} from "../geo/measure"
import { Geom, verticesOf } from "../geo/types"
import { actions, currentParams, useStore } from "../store"

function Stats(props: { geom: Geom | null }) {
  const g = props.geom
  if (!g) return <div className="muted">—</div>
  const verts = verticesOf(g).length
  const bb = bboxOf(g)
  const c = centroidOf(g)
  const area = areaOf(g)
  const len = lengthOf(g)
  const per = perimeterOf(g)
  return (
    <table className="stats-table">
      <tbody>
        <tr>
          <td>Type</td>
          <td>{g.type}</td>
        </tr>
        <tr>
          <td>Vertices</td>
          <td>{verts}</td>
        </tr>
        {area > 0 ? (
          <tr>
            <td>Area</td>
            <td>{fmt(area)}</td>
          </tr>
        ) : null}
        {len > 0 ? (
          <tr>
            <td>Length</td>
            <td>{fmt(len)}</td>
          </tr>
        ) : null}
        {per > 0 ? (
          <tr>
            <td>Perimeter</td>
            <td>{fmt(per)}</td>
          </tr>
        ) : null}
        {bb ? (
          <tr>
            <td>BBox</td>
            <td>{fmt(bb[2] - bb[0]) + " × " + fmt(bb[3] - bb[1])}</td>
          </tr>
        ) : null}
        {c ? (
          <tr>
            <td>Center</td>
            <td>{"(" + fmt(c[0]) + ", " + fmt(c[1]) + ")"}</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  )
}

export function Inspector(props: { fn: FnDef; run: RunOutput | null }) {
  const s = useStore()
  const { fn, run } = props
  const params = currentParams(s)

  return (
    <div className="inspector">
      <h2 className="insp-fn">{fn.name}</h2>
      <p className="insp-summary">{fn.summary}</p>

      {fn.needsB && !s.b ? (
        <div className="hint-b">
          {"This function needs geometry B" +
            (fn.bHint ? " (" + fn.bHint + ")" : "") +
            ". Switch the editor to B and draw, or load the sample."}
        </div>
      ) : null}

      {fn.params.length > 0 ? <div className="insp-title">Parameters</div> : null}
      {fn.params.map((p) => (
        <div key={p.key} className="param-row">
          <div className="param-head">
            <span>{p.label}</span>
            <span className="param-value">{params[p.key] ?? p.def}</span>
          </div>
          <input
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={params[p.key] ?? p.def}
            onChange={(e) => actions.setParam(p.key, Number(e.target.value))}
          />
        </div>
      ))}

      {run && run.message ? <div className="warn">{run.message}</div> : null}
      {run && run.value ? <div className="value-big">{run.value}</div> : null}

      <div className="insp-title">Before</div>
      <div className="stats-head">
        <span className="dot dot-a" />
        Geometry A
      </div>
      <Stats geom={s.a} />
      {s.b ? (
        <div>
          <div className="stats-head">
            <span className="dot dot-b" />
            Geometry B
          </div>
          <Stats geom={s.b} />
        </div>
      ) : null}

      <div className="insp-title">After</div>
      <div className="stats-head">
        <span className="dot dot-result" />
        Result
      </div>
      <Stats geom={run ? run.result : null} />

      <div className="insp-title">How it works</div>
      {fn.doc.map((d, i) => (
        <p key={i} className="doc-p">
          {d}
        </p>
      ))}
    </div>
  )
}
