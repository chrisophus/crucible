import { build } from "esbuild"
import { chmodSync } from "node:fs"
import { mkdir } from "node:fs/promises"

await mkdir("dist", { recursive: true })

const shared = {
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node18",
}

await build({
  ...shared,
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  banner: { js: "#!/usr/bin/env node" },
})

await build({
  ...shared,
  entryPoints: ["src/mcp.ts"],
  outfile: "dist/mcp.js",
  banner: { js: "#!/usr/bin/env node" },
})

chmodSync("dist/cli.js", 0o755)
chmodSync("dist/mcp.js", 0o755)
