import { createRoot } from "react-dom/client"
import { App } from "./components/App"

const el = document.getElementById("root")
if (el) {
  createRoot(el).render(<App />)
}
