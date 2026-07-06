// Tiny external store (no dependencies) + all app actions.

import { useSyncExternalStore } from "react"
import { Geom, cloneGeom } from "./geo/types"
import { DEFAULT_FN, defaultParams, findFn } from "./catalog"

export type Tool = "select" | "point" | "line" | "polygon"
export type Slot = "a" | "b"
export type Theme = "light" | "dark"
export type DialogKind = "geojson" | null

type Snapshot = { a: Geom | null; b: Geom | null }

export type State = {
  fnName: string
  paramsByFn: Record<string, Record<string, number>>
  a: Geom | null
  b: Geom | null
  tool: Tool
  activeSlot: Slot
  theme: Theme
  compare: boolean
  frame: number
  playing: boolean
  dialog: DialogKind
  undoStack: Snapshot[]
  redoStack: Snapshot[]
}

export const SAMPLE_A: Geom = {
  type: "Polygon",
  coordinates: [
    [
      [210, 190],
      [322, 236],
      [415, 150],
      [452, 268],
      [566, 306],
      [452, 362],
      [470, 470],
      [352, 408],
      [238, 462],
      [268, 342],
      [172, 286],
    ],
  ],
}

export const SAMPLE_B: Geom = {
  type: "Polygon",
  coordinates: [
    [
      [430, 250],
      [612, 224],
      [656, 386],
      [482, 432],
      [398, 338],
    ],
  ],
}

const THEME_KEY = "geoexplain-theme"

function initialTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY)
    if (t === "dark" || t === "light") return t
  } catch (err) {
    // localStorage unavailable
  }
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark"
  }
  return "light"
}

function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t
}

let state: State = {
  fnName: DEFAULT_FN,
  paramsByFn: {},
  a: cloneGeom(SAMPLE_A),
  b: cloneGeom(SAMPLE_B),
  tool: "select",
  activeSlot: "a",
  theme: initialTheme(),
  compare: false,
  frame: 0,
  playing: true,
  dialog: null,
  undoStack: [],
  redoStack: [],
}

applyTheme(state.theme)

const listeners = new Set<() => void>()

function set(patch: Partial<State>): void {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getState(): State {
  return state
}

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState)
}

export function currentParams(s: State): Record<string, number> {
  return s.paramsByFn[s.fnName] ?? defaultParams(findFn(s.fnName))
}

function snap(): Snapshot {
  return { a: state.a, b: state.b }
}

const MAX_UNDO = 60

export const actions = {
  setTool(tool: Tool): void {
    set({ tool })
  },

  setActiveSlot(activeSlot: Slot): void {
    set({ activeSlot })
  },

  setFn(fnName: string): void {
    set({ fnName, frame: 0, playing: true })
  },

  setParam(key: string, value: number): void {
    const fnName = state.fnName
    const cur = state.paramsByFn[fnName] ?? defaultParams(findFn(fnName))
    const nextForFn = { ...cur, [key]: value }
    const paramsByFn = { ...state.paramsByFn, [fnName]: nextForFn }
    set({ paramsByFn, frame: 9999, playing: false })
  },

  checkpoint(): void {
    set({
      undoStack: [...state.undoStack, snap()].slice(-MAX_UNDO),
      redoStack: [],
    })
  },

  setGeom(slot: Slot, g: Geom | null, withCheckpoint = true): void {
    const patch: Partial<State> = { frame: 9999, playing: false }
    if (withCheckpoint) {
      patch.undoStack = [...state.undoStack, snap()].slice(-MAX_UNDO)
      patch.redoStack = []
    }
    if (slot === "a") patch.a = g
    else patch.b = g
    set(patch)
  },

  undo(): void {
    const prev = state.undoStack[state.undoStack.length - 1]
    if (!prev) return
    set({
      a: prev.a,
      b: prev.b,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, snap()],
      frame: 9999,
      playing: false,
    })
  },

  redo(): void {
    const next = state.redoStack[state.redoStack.length - 1]
    if (!next) return
    set({
      a: next.a,
      b: next.b,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, snap()].slice(-MAX_UNDO),
      frame: 9999,
      playing: false,
    })
  },

  loadSample(): void {
    set({
      undoStack: [...state.undoStack, snap()].slice(-MAX_UNDO),
      redoStack: [],
      a: cloneGeom(SAMPLE_A),
      b: cloneGeom(SAMPLE_B),
      frame: 0,
      playing: true,
    })
  },

  clearAll(): void {
    set({
      undoStack: [...state.undoStack, snap()].slice(-MAX_UNDO),
      redoStack: [],
      a: null,
      b: null,
      frame: 0,
      playing: false,
    })
  },

  setTheme(theme: Theme): void {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch (err) {
      // ignore
    }
    applyTheme(theme)
    set({ theme })
  },

  setCompare(compare: boolean): void {
    set({ compare })
  },

  setFrame(frame: number, stopPlaying = true): void {
    if (stopPlaying) set({ frame, playing: false })
    else set({ frame })
  },

  setPlaying(playing: boolean): void {
    set({ playing })
  },

  replay(): void {
    set({ frame: 0, playing: true })
  },

  setDialog(dialog: DialogKind): void {
    set({ dialog })
  },
}
