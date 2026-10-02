// Benchmark: TUI startup, process spawn to first render / plugins ready / sync complete.
//
// Usage (from repo root):
//   bun run perf/bench-tui-startup.ts
//   BENCH_RUNS=5 bun run perf/bench-tui-startup.ts
//
// Spawns the dev TUI (`bun run --cwd packages/opencode src/index.ts`) in a detached
// tmux session with OPENCODE_STARTUP_TIMING set, waits for all startup marks, then
// prints per-run mark timings and a median summary. Requires tmux.

import { mkdtempSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"

const runs = Number(process.env.BENCH_RUNS ?? 3)
const timeoutMs = Number(process.env.BENCH_TIMEOUT_MS ?? 90_000)
const root = path.resolve(import.meta.dir, "..")
const session = `oc-startup-bench-${process.pid}`

const wanted = [
  "cli:imports",
  "tui:handler",
  "worker:imports",
  "tui:worker",
  "tui:config",
  "tui:run-imports",
  "tui:renderer",
  "tui:theme-mode",
  "worker:first-fetch",
  "worker:first-response",
  "tui:first-render",
  "tui:plugin-load-start",
  "tui:plugin-origins",
  "tui:plugins-resolved",
  "tui:plugins",
  "tui:sync-partial",
  "tui:sync-complete",
]

async function sh(cmd: string[]) {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
  const code = await proc.exited
  const out = await new Response(proc.stdout).text()
  if (code !== 0) throw new Error(`${cmd.join(" ")} failed (${code}): ${await new Response(proc.stderr).text()}`)
  return out.trim()
}

async function once(index: number) {
  const dir = mkdtempSync(path.join(tmpdir(), "oc-tui-bench-"))
  const file = path.join(dir, "timing.log")
  const bun = process.execPath
  const name = `${session}-${index}`
  const launch = Date.now()
  // OPENCODE_PURE stays unset: benchmark what users actually run.
  const command = `cd ${root} && OPENCODE_STARTUP_TIMING=${file} ${bun} run --cwd packages/opencode src/index.ts`
  await sh(["tmux", "new-session", "-d", "-s", name, "-x", "200", "-y", "50", command])
  try {
    const deadline = Date.now() + timeoutMs
    let marks = new Map<string, number>()
    while (Date.now() < deadline) {
      marks = parse(file)
      if (marks.has("tui:plugins") && marks.has("tui:sync-complete")) break
      await Bun.sleep(100)
    }
    const missing = wanted.filter((mark) => !marks.has(mark))
    if (missing.length) console.log(`run ${index + 1}: timed out waiting for: ${missing.join(", ")}`)
    return { launch, marks }
  } finally {
    await sh(["tmux", "kill-session", "-t", name]).catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}

function parse(file: string) {
  const marks = new Map<string, number>()
  let text = ""
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return marks
  }
  for (const line of text.split("\n")) {
    const [stamp, name] = line.split("\t")
    if (!stamp || !name) continue
    if (!marks.has(name)) marks.set(name, Number(stamp))
  }
  return marks
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

console.log(`tui startup benchmark: ${runs} run(s), spawning dev TUI in tmux\n`)
const results = []
for (let i = 0; i < runs; i++) {
  const result = await once(i)
  results.push(result)
  console.log(`run ${i + 1}:`)
  for (const [name, stamp] of [...result.marks.entries()].sort((a, b) => a[1] - b[1])) {
    console.log(`  ${(stamp - result.launch).toFixed(0).padStart(7)} ms  ${name}`)
  }
  console.log()
}

console.log("median ms from spawn:")
for (const name of wanted) {
  const stamps = results.flatMap((result) => {
    const stamp = result.marks.get(name)
    return stamp === undefined ? [] : [stamp - result.launch]
  })
  if (!stamps.length) continue
  console.log(`  ${median(stamps).toFixed(0).padStart(7)} ms  ${name}`)
}
