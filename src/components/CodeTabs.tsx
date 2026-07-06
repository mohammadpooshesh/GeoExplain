import { useState } from "react"
import { CodeSnippets } from "../catalog"

const TABS: Array<{ id: keyof CodeSnippets; label: string }> = [
  { id: "postgis", label: "PostGIS" },
  { id: "turf", label: "Turf.js" },
  { id: "shapely", label: "Shapely" },
  { id: "gdal", label: "GDAL" },
]

export function CodeTabs(props: { snippets: CodeSnippets }) {
  const [tab, setTab] = useState<keyof CodeSnippets>("postgis")
  const [copied, setCopied] = useState(false)
  const code = props.snippets[tab]

  const copy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).catch(() => undefined)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="codetabs">
      <div className="ct-head">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={"ct-tab" + (tab === t.id ? " active" : "")}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button className="ct-copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="ct-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}
