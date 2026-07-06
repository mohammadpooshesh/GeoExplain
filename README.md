# GeoExplain

**Understand Spatial SQL Visually** — *See what your geometry is doing.*

GeoExplain is an interactive playground for spatial SQL functions. Think **regex101, but for PostGIS**: draw a geometry (or import GeoJSON), pick a function like `ST_Buffer`, and watch a **step-by-step animation** of exactly what the operation does to your geometry — alongside live parameters, before/after stats, and equivalent code in PostGIS, Turf.js, Shapely and GDAL/OGR.

👉 **Live demo:** https://mohammadpooshesh.github.io/GeoExplain/

> ⚠️ GeoExplain does **not** execute any real SQL. It is a pure client-side **visualizer**: every operation runs in your browser on a planar canvas, so you can build intuition for what each PostGIS function means.

## Features

- **30 spatial functions**, organized by category:
  - **Geometry** — `ST_Buffer`, `ST_Union`, `ST_Difference`, `ST_Intersection`, `ST_SymDifference`, `ST_Split`, `ST_Collect`, `ST_UnaryUnion`
  - **Measurement** — `ST_Area`, `ST_Length`, `ST_Perimeter`, `ST_Distance`, `ST_MaxDistance`, `ST_Azimuth`
  - **Geometry Processing** — `ST_Simplify`, `ST_SimplifyVW`, `ST_Snap`, `ST_RemoveRepeatedPoints`, `ST_Reverse`, `ST_Segmentize`
  - **Analysis** — `ST_ConvexHull`, `ST_ConcaveHull`, `ST_Centroid`, `ST_PointOnSurface`, `ST_MinimumBoundingCircle`, `ST_Envelope`
  - **Validation** — `ST_IsValid`, `ST_IsSimple`, `ST_MakeValid`, `ST_IsClosed`
- **Step-by-step animations** for every function — buffers grow outward, unions dissolve boundaries, splits pull the parts apart, simplification drops vertices one tolerance step at a time. Scrub the timeline forward and backward, or replay.
- **Interactive canvas** — draw points, lines and polygons; drag whole shapes or individual vertices; pan and zoom.
- **Two geometry slots (A / B)** for binary operations like union, difference, distance and snap.
- **Inspector** with before/after stats: geometry type, vertices, segments, area, perimeter/length, bounding box, center, and result coordinates.
- **Per-function parameter panels** with sliders (buffer distance, smoothing segments, simplify tolerance, snap tolerance, …) and a live-updating result.
- **Educational docs** for every function: what it does, inputs, outputs, parameter effects, and gotchas.
- **Equivalent code**, generated live for **PostGIS**, **Turf.js**, **Shapely** and **GDAL/OGR**.
- **Compare mode** — a draggable Before | After curtain slider.
- **GeoJSON import** (paste, file picker, or drag & drop) and **export to GeoJSON / SVG / PNG**.
- **Undo / redo**, dark / light theme, keyboard shortcuts (`Ctrl+Z`, `Ctrl+Shift+Z`, `Enter`, `Esc`).

## How it works

GeoExplain is a **zero-dependency** React + TypeScript app (React is the only runtime library). Instead of wrapping a GIS library, it ships its own small computational-geometry engine (`src/geo/`):

- `types.ts` — a GeoJSON-compatible geometry model
- `measure.ts` — area, length, centroid, distance, azimuth, bounding boxes
- `algorithms.ts` — convex hull (monotone chain), minimum bounding circle (Welzl), Douglas‑Peucker & Visvalingam‑Whyatt simplification, snapping, segmentize, self-intersection tests
- `field.ts` — a signed-distance-field engine with marching squares, used for buffer, boolean overlays (union / intersection / difference / xor), split, make-valid and concave hull — which also makes the smooth in-between animation frames possible

The UI (`src/components/`) renders everything as SVG, which keeps the canvas crisp at every zoom level and makes SVG/PNG export trivial. The function catalog (`src/catalog.ts`) defines each function's docs, parameters, generated code and animation frames.

## Development

```bash
npm install
npm run build     # bundles src/main.tsx -> dist/app.js with esbuild
npm run dev       # same, in watch mode
```

Then open `index.html` in a browser — no dev server required.

## Deployment

Pushing to `main` triggers the GitHub Actions workflow in `.github/workflows/deploy.yml`, which builds the bundle and publishes `index.html`, `styles.css` and `dist/app.js` to **GitHub Pages**.

## Roadmap (v2 ideas)

- Expression builder for nested calls like `ST_Buffer(ST_Centroid(geom), 200)` with per-step visualization
- Multi-step pipelines with intermediate outputs
- Shareable scenario links
- Plugin API for adding new functions
- Quiz mode for learning PostGIS

---

## معرفی فارسی

**GeoExplain** یک زمینِ بازی تعاملی برای توابع Spatial SQL است — چیزی شبیه regex101 اما برای PostGIS.

هندسه را رسم کنید یا GeoJSON وارد کنید، یک تابع مثل `ST_Buffer` را انتخاب کنید و ببینید که این تابع مرحله‌به‌مرحله و به‌صورت انیمیشن چه بلایی سر هندسه می‌آورد. در کنار آن، پارامترها را با اسلایدر تغییر دهید، آمار قبل/بعد را مقایسه کنید و کد معادل را در PostGIS، Turf.js، Shapely و GDAL ببینید.

این پروژه هیچ SQL واقعی اجرا نمی‌کند؛ فقط یک Visualizer آموزشی است که تمام محاسبات آن در مرورگر انجام می‌شود.

## License

[MIT](./LICENSE)
