import { Frame } from "../catalog"
import { actions, useStore } from "../store"

export function Timeline(props: { frames: Frame[]; frameIdx: number }) {
  const s = useStore()
  const { frames, frameIdx } = props
  const n = frames.length
  const label = n > 0 ? frames[frameIdx].label : "Draw a geometry to see steps"

  const togglePlay = () => {
    if (s.playing) actions.setPlaying(false)
    else if (frameIdx >= n - 1) actions.replay()
    else actions.setPlaying(true)
  }

  return (
    <div className="timeline">
      <button className="tl-btn" disabled={n < 2} onClick={actions.replay} title="Replay">
        ↺
      </button>
      <button
        className="tl-btn"
        disabled={n < 2 || frameIdx === 0}
        onClick={() => actions.setFrame(frameIdx - 1)}
        title="Previous step"
      >
        ◀
      </button>
      <button className="tl-btn" disabled={n < 2} onClick={togglePlay} title="Play / pause">
        {s.playing ? "❚❚" : "▶"}
      </button>
      <button
        className="tl-btn"
        disabled={n < 2 || frameIdx >= n - 1}
        onClick={() => actions.setFrame(frameIdx + 1)}
        title="Next step"
      >
        ▶▏
      </button>
      <input
        className="tl-slider"
        type="range"
        min={0}
        max={Math.max(0, n - 1)}
        step={1}
        value={frameIdx}
        disabled={n < 2}
        onChange={(e) => actions.setFrame(Number(e.target.value))}
      />
      <div className="tl-label">
        {n > 0 ? "Step " + (frameIdx + 1) + " / " + n + " — " + label : label}
      </div>
    </div>
  )
}
