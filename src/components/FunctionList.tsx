import { useState } from "react"
import { CATALOG } from "../catalog"
import { actions, useStore } from "../store"

export function FunctionList() {
  const s = useStore()
  const [q, setQ] = useState("")
  const needle = q.trim().toLowerCase()

  return (
    <div className="sidebar">
      <input
        className="search"
        placeholder="Search functions…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {CATALOG.map((cat) => {
        const fns = cat.fns.filter(
          (f) => needle === "" || f.name.toLowerCase().includes(needle),
        )
        if (fns.length === 0) return null
        return (
          <div key={cat.category}>
            <div className="cat-title">{cat.category}</div>
            {fns.map((f) => (
              <button
                key={f.name}
                className={"fn-btn" + (s.fnName === f.name ? " active" : "")}
                onClick={() => actions.setFn(f.name)}
                title={f.summary}
              >
                {f.name}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
