import { build, context } from "esbuild"

const watch = process.argv.includes("--watch")

const options = {
  entryPoints: ["src/main.tsx"],
  outfile: "dist/app.js",
  bundle: true,
  format: "iife",
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  target: "es2020",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
  nodePaths: (process.env.NODE_PATH ?? "").split(":").filter(Boolean),
}

if (watch) {
  const ctx = await context(options)
  await ctx.watch()
  console.log("watching\u2026")
} else {
  await build(options)
}
