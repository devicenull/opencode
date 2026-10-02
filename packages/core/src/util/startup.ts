// Startup timing instrumentation. Enabled by setting OPENCODE_STARTUP_TIMING to a
// file path; each process (cli, worker, tui) appends wall-clock marks so spans
// can be compared across processes. Zero cost when unset.
import { appendFileSync } from "fs"

const file = process.env.OPENCODE_STARTUP_TIMING

export function mark(name: string) {
  if (!file) return
  try {
    appendFileSync(file, `${Date.now()}\t${name}\t${process.pid}\n`)
  } catch {}
}

export * as StartupTiming from "./startup"
