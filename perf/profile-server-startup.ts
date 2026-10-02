// Isolated repro of the TUI-startup server critical path, for CPU profiling.
// Run from packages/opencode:
//   bun --cpu-prof --cpu-prof-md --cpu-prof-dir=/tmp/opencode/prof run ../../perf/profile-server-startup.ts
// Boots Server.Default() in-process and fires the same requests the TUI bootstrap fires.

import { Server } from "../packages/opencode/src/server/server"

const directory = process.cwd()
console.log("directory:", directory)

function req(path: string) {
  return new Request(`http://localhost${path}`, {
    headers: { "x-opencode-directory": directory },
  })
}

const t0 = performance.now()
const stamp = (name: string) => console.log(`${(performance.now() - t0).toFixed(0).padStart(7)} ms  ${name}`)

const app = Server.Default().app
stamp("server boot")

// Same blocking set as TUI bootstrap, fired concurrently like the real client does.
await Promise.all([
  app.fetch(req("/config")).then((r) => r.text()).then(() => stamp("/config")),
  app.fetch(req("/config/providers")).then((r) => r.text()).then(() => stamp("/config/providers")),
  app.fetch(req("/provider")).then((r) => r.text()).then(() => stamp("/provider")),
  app.fetch(req("/agent")).then((r) => r.text()).then(() => stamp("/agent")),
  app.fetch(req("/project/current")).then((r) => r.text()).then(() => stamp("/project/current")),
])
stamp("blocking phase done")
process.exit(0)
