import { describe, expect, test } from "bun:test"
import { LazyCommands } from "@/cli/commands"

// The lazy registry in src/cli/commands.ts duplicates each command's
// command/describe/aliases so modules stay unloaded until invoked. Guard against drift.
describe("lazy cli command registry", () => {
  for (const entry of LazyCommands) {
    test(String(entry.command), async () => {
      const mod = await entry.load()
      expect(mod.command).toBe(entry.command)
      expect("describe" in mod ? mod.describe : undefined).toBe(entry.describe)
      expect("aliases" in mod ? mod.aliases : undefined).toEqual(entry.aliases)
    })
  }
})
