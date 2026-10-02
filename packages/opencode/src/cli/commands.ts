import type { Argv, CommandModule } from "yargs"
import { cmd, type WithDoubleDash } from "./cmd/cmd"

// Lazy command registry: every command module is imported on first use instead of
// at startup, since the full static graph costs ~1.5s before any command can run.
// The metadata below must match each module's export; test/cli/commands.test.ts
// guards against drift.

type LazyCommand = {
  command: string | readonly string[]
  describe?: string | false
  aliases?: readonly string[]
  // Heterogeneous registry boundary: per-command option types stay inside each module.
  load: () => Promise<CommandModule<any, any>>
}

function lazy(input: LazyCommand) {
  let cached: ReturnType<typeof input.load> | undefined
  const ready = () => (cached ??= input.load())
  return cmd<any, any>({
    command: input.command,
    describe: input.describe,
    aliases: input.aliases,
    builder: async (yargs) => {
      const mod = await ready()
      if (!mod.builder) return yargs
      const out = await (mod.builder as (args: Argv) => Argv | PromiseLike<Argv> | undefined)(yargs)
      return out ?? yargs
    },
    handler: (args) => ready().then((mod) => mod.handler(args)),
  })
}

export const LazyCommands = [
  {
    command: "acp",
    describe: "start ACP (Agent Client Protocol) server",
    load: () => import("./cmd/acp").then((m) => m.AcpCommand),
  },
  {
    command: "mcp",
    describe: "manage MCP (Model Context Protocol) servers",
    load: () => import("./cmd/mcp").then((m) => m.McpCommand),
  },
  {
    command: "$0 [project]",
    describe: "start opencode tui",
    load: () => import("./cmd/tui").then((m) => m.TuiThreadCommand),
  },
  {
    command: "attach <url>",
    describe: "attach to a running opencode server",
    load: () => import("./cmd/attach").then((m) => m.AttachCommand),
  },
  {
    command: "run [message..]",
    describe: "run opencode with a message",
    load: () => import("./cmd/run").then((m) => m.RunCommand),
  },
  {
    command: "generate",
    load: () => import("./cmd/generate").then((m) => m.GenerateCommand),
  },
  {
    command: "debug",
    describe: "debugging and troubleshooting tools",
    load: () => import("./cmd/debug/index").then((m) => m.DebugCommand),
  },
  {
    command: "console",
    describe: false,
    load: () => import("./cmd/account").then((m) => m.ConsoleCommand),
  },
  {
    command: "providers",
    describe: "manage AI providers and credentials",
    aliases: ["auth"],
    load: () => import("./cmd/providers").then((m) => m.ProvidersCommand),
  },
  {
    command: "agent",
    describe: "manage agents",
    load: () => import("./cmd/agent").then((m) => m.AgentCommand),
  },
  {
    command: "upgrade [target]",
    describe: "upgrade opencode to the latest or a specific version",
    load: () => import("./cmd/upgrade").then((m) => m.UpgradeCommand),
  },
  {
    command: "uninstall",
    describe: "uninstall opencode and remove all related files",
    load: () => import("./cmd/uninstall").then((m) => m.UninstallCommand),
  },
  {
    command: "serve",
    describe: "starts a headless opencode server",
    load: () => import("./cmd/serve").then((m) => m.ServeCommand),
  },
  {
    command: "web",
    describe: "start opencode server and open web interface",
    load: () => import("./cmd/web").then((m) => m.WebCommand),
  },
  {
    command: "models [provider]",
    describe: "list all available models",
    load: () => import("./cmd/models").then((m) => m.ModelsCommand),
  },
  {
    command: "stats",
    describe: "show token usage and cost statistics",
    load: () => import("./cmd/stats").then((m) => m.StatsCommand),
  },
  {
    command: "export [sessionID]",
    describe: "export session data as JSON",
    load: () => import("./cmd/export").then((m) => m.ExportCommand),
  },
  {
    command: "import <file>",
    describe: "import session data from JSON file or URL",
    load: () => import("./cmd/import").then((m) => m.ImportCommand),
  },
  {
    command: "github",
    describe: "manage GitHub agent",
    load: () => import("./cmd/github").then((m) => m.GithubCommand),
  },
  {
    command: "pr <number>",
    describe: "fetch and checkout a GitHub PR branch, then run opencode",
    load: () => import("./cmd/pr").then((m) => m.PrCommand),
  },
  {
    command: "session",
    describe: "manage sessions",
    load: () => import("./cmd/session").then((m) => m.SessionCommand),
  },
  {
    command: "plugin <module>",
    describe: "install plugin and update config",
    aliases: ["plug"],
    load: () => import("./cmd/plug").then((m) => m.PluginCommand),
  },
  {
    command: "db",
    describe: "database tools",
    load: () => import("./cmd/db").then((m) => m.DbCommand),
  },
] satisfies LazyCommand[]

export const Commands = LazyCommands.map((entry) => lazy(entry))

export * as CliCommands from "./commands"
