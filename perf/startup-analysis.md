# TUI Startup Slowness Analysis

## Goal

Explain why the compiled `opencode` binary takes ~6.2s from spawn to a usable TUI,
with the server-side costs identified precisely.

## Method

- Binary benchmark: spawn the installed binary (same md5 as `packages/opencode/dist` build of
  this branch) in tmux with `OPENCODE_STARTUP_TIMING` set, 3 runs, marks compared across
  processes (cli / tui main thread / worker thread). Numbers below are representative
  (run-to-run spread is small, +-5%).
- In-process repro: `perf/profile-server-startup.ts` under `bun --cpu-prof`, plus targeted
  microbenchmarks against the real `~/.cache/opencode/models.json` (5.3 MB,
  226 providers, 8383 models).
- Dev-mode comparison: `perf/bench-tui-startup.ts` (source, bun run) = ~9.3s. The binary is
  already the fast case; the slow path is architectural, not packaging.

## Measured timeline (binary, median)

```
   250 ms  cli:imports            entry module eval (yargs, UI, lazy command registry)
   550 ms  tui:handler            yargs parse + lazy import of cmd/tui          (~300 ms)
  1180 ms  tui:worker             import("@/config/tui") + new Worker + RPC     (~630 ms)
  1300 ms  tui:config             TuiConfig.get                                 (~120 ms)
  1550 ms  tui:run-imports        dynamic imports: effect, tui/layer, plugins   (~250 ms)
  1750 ms  tui:theme-mode         theme wait (already shortened on this branch) (~180 ms)
  1780 ms  tui:first-render       <-- first pixels, ~1.8s
  2410 ms  worker:imports         worker thread evaluates ENTIRE server graph   (~1.2 s)
  2410 ms  worker:first-fetch
  3450 ms  config:load-start      first request builds full Effect layer graph  (~1.0 s)
  3770 ms  config:load-done       3 config dirs, ~90-130 ms each                (~250 ms)
  3550 ms  plugin:state-done      plugin load                                   (~30 ms)
  3740 ms  provider:models-dev    read + parse 5.3 MB models.json cache         (~80 ms)
  4600 ms  provider:catalog-mapped map 8383 models + per-model schema checks    (~850 ms)
  4850 ms  agent:state-done       starved behind catalog mapping on same thread
  4900 ms  provider:state-done
  5700 ms  worker:fetch /provider  schema-encode + serialize 6.4 MB response    (~800 ms)
  6100 ms  tui:sync-partial       RPC transfer + JSON.parse + reconcile         (~400 ms)
  6300 ms  tui:sync-complete      <-- usable, ~6.3s
```

## Root causes, ranked

### 1. The whole models.dev catalog is processed eagerly, synchronously (~850 ms)

`Provider` state construction (`provider.ts:1462-1467`) runs, on first use:

```ts
const catalog = mapValues(modelsDev, fromModelsDevProvider)   //   88 ms
const database = mapValues(catalog, toPublicInfo)             //  706 ms
```

Microbenchmark on the real catalog (226 providers, 8383 models):

- `fromModelsDevProvider` (all providers): 88 ms
- `toPublicInfo` (all providers): 706 ms, decomposed as:
  - `Schema.is(Model)(model)` filter per model: **394 ms**
  - JSON round-trip replacer walk: ~220 ms
  - `JSON.parse(JSON.stringify(...))` itself: 92 ms

This is pure synchronous CPU on the single worker thread. While it runs, every other
in-flight bootstrap request (`/agent`, `/config/providers`, config load) is starved --
`agent:state-start` to `agent:state-done` spans ~1.2s but almost all of it is queueing
behind this mapping. The `Schema.is` filter validates 8383 models that were just
constructed to be valid from models.dev data; it only ever matters for
config/plugin-patched entries, which are merged later anyway.

### 2. `/provider` schema-encodes and ships a 6.4 MB response per call (~800 ms server-side)

The endpoint's success schema is `Provider.ListResult` (all providers x all models).
Measured warm cost (state already built): **840 ms per request**, decomposed as:

- `Schema.encodeSync(ListResult)`: 654 ms
- `JSON.stringify`: 113 ms (6.38 MB body)
- `defaultModelIDs`: 39 ms

Compare `/config/providers` (returns only connected providers): 6 ms warm.

Then the cost repeats on the TUI side: the worker does `response.text()` on 6.4 MB,
ships the string over the worker RPC boundary, the SDK client `JSON.parse`s it on the
UI thread, and `reconcile()` diffs 8383 models into the solid store (~400 ms total,
the gap between `/provider` responding and `tui:sync-partial`).

Worst part: the TUI does not need this data to render. `sync.data.provider_next`
(the `/provider` result) is only consumed by `dialog-provider.tsx` -- the model/provider
picker dialog. Everything visible at startup (session view, footer, current model) uses
`sync.data.provider`, which comes from the 6 ms `/config/providers` call. Yet
`bootstrap()` in `packages/tui/src/context/sync.tsx:461` awaits `provider.list` in its
blocking phase, so `tui:sync-partial` waits on the single most expensive route.

### 3. Worker thread boot re-evaluates the entire server module graph (~1.2 s)

The TUI runs the server in a worker thread (`cli/tui/worker.ts`), which statically
imports `server/server.ts`, which imports every route group, every service
(Session stack, Provider, MCP, LSP, ToolRegistry, Database, ...), the ai-sdk packages,
drizzle, and Effect itself. From `new Worker(...)` returning to the first line of
worker.ts executing: ~1.2s in the binary. Add ~630 ms in the parent for
`import("@/config/tui")` + Worker construction + RPC setup.

### 4. First request builds the whole Effect layer graph (~1.0 s)

`Server.Default()` / `HttpRouter.toWebHandler` return instantly; the cost lands inside
the first `app.fetch`. Every `HttpApiBuilder.group(...)` yields its services at layer
construction, so the first request transitively builds all ~60 services in
`httpapi/server.ts`'s `app` group (sqlite open + migrations, ModelsDev, Ripgrep
resolution, project bootstrap, ...) plus lazy Effect Schema codec derivation for the
routes being hit. Isolated measurement of `Layer.build(routes)`: ~683 ms (dev).
The 5 initial concurrent TUI fetches (`/config`, `/path`, `/project/current`,
`/experimental/capabilities`, `/experimental/console`) all unblock together after
~1.3-1.4s for exactly this reason.

### 5. CLI entry cost before the TUI handler runs (~500 ms)

`--version` alone takes ~500 ms: ~250 ms entry module eval (yargs, UI, command
registry) + ~250-300 ms yargs parse and lazy `cmd/tui` import. The lazy command
registry on this branch already removed the static command graph; what remains is
yargs itself plus the entry imports.

### 6. Config load across 3 config directories (~250 ms)

`~/.config/opencode`, `<project>/.opencode`, `~/.opencode`: ~90-130 ms each of
file globs, jsonc parsing, plugin dep resolution, `ensureGitignore`. Secondary cost,
but it sits on the critical path before provider/agent state can build.

## What is NOT the problem

- The branch's fixes are all present and working: lazy command registration, the
  `/config/providers` mapped-catalog reuse (6 ms warm), shortened theme-mode wait.
- Dev mode is *slower* (9.3s) due to transpilation; the binary is not the issue.
- Plugin loading is fast (~30 ms). models.dev cache read is fast (~80 ms).

## Fix directions, by payoff

1. **Stop blocking TUI bootstrap on `/provider`.** Move `provider.list` out of the
   blocking `Promise.all` in `sync.tsx` and into the non-blocking phase (or fetch it
   lazily when the provider dialog opens). This alone removes ~1.6-2s from time-to-usable
   (route encode + transfer + parse + reconcile), without touching the server.
   DONE: `sync.ensureProviderList()` now lazy-loads the catalog when the connect-provider
   dialog opens; bootstrap never fetches it (dev sync-complete 9.3s -> 7.8s).
2. **Cache or skip the response encode.** The pristine `publicCatalog` never changes
   between state rebuilds: pre-serialize it once (the `docResponse` pattern in
   `httpapi/server.ts`) or use `jsonUnsafe` and only encode the small
   `connected`/`default` deltas. Saves ~650-750 ms per `/provider` call.
3. **Drop the per-model `Schema.is` filter and the JSON deep-copy** in the provider
   state build (validate only config/plugin-patched providers; copy only providers that
   actually get patched, or use `structuredClone`). Saves ~600-700 ms of synchronous CPU
   and un-starves `/agent`, `/config/providers`, and config load.
4. **Lazily build the service graph.** Nothing should pay for all ~60 services on
   request #1; making handler groups yield services per-endpoint (or pre-building the
   graph in parallel with worker module eval) removes most of the ~1.0s first-fetch stall.
5. **Slim the worker's module graph** or move first-render-critical work off the worker
   boot path (~1.2s of module evaluation before the first fetch can even be answered).

## Reproduce

```sh
# binary timeline
OPENCODE_STARTUP_TIMING=/tmp/t.log opencode   # in tmux, then read /tmp/t.log

# server critical path in-process
cd packages/opencode
bun --cpu-prof --cpu-prof-dir=/tmp/prof run ../../perf/profile-server-startup.ts
```
