import { describe, expect, test } from "bun:test"
import { Agent } from "@/agent/agent"
import { Repository } from "@opencode-ai/core/repository"
import { Global } from "@opencode-ai/core/global"
import path from "path"

describe("referencePaths", () => {
  const directory = "/repo/project"

  test("git shorthand resolves to the repository cache path", () => {
    const repo = Repository.parse("github.com/Effect-TS/effect-smol")!
    expect(Agent.referencePaths({ references: { effect: { repository: "github.com/Effect-TS/effect-smol" } } }, directory)).toEqual([
      Repository.cachePath(Global.Path.repos, repo, undefined),
    ])
  })

  test("git string entries and branches match materialized paths", () => {
    const repo = Repository.parse("github.com/Effect-TS/effect-smol")!
    expect(
      Agent.referencePaths(
        { references: { effect: { repository: "github.com/Effect-TS/effect-smol", branch: "dev/x" } } },
        directory,
      ),
    ).toEqual([Repository.cachePath(Global.Path.repos, repo, "dev/x")])
    expect(
      Agent.referencePaths({ references: { effect: "github.com/Effect-TS/effect-smol" } }, directory),
    ).toEqual([Repository.cachePath(Global.Path.repos, repo, undefined)])
  })

  test("local entries resolve home, absolute, and instance-relative paths", () => {
    const result = Agent.referencePaths(
      {
        references: {
          home: "~/docs",
          abs: "/var/data",
          rel: "./docs",
          obj: { path: "../shared" },
        },
      },
      directory,
    )
    expect(result).toEqual([
      path.join(Global.Path.home, "docs"),
      "/var/data",
      path.resolve(directory, "./docs"),
      path.resolve(directory, "../shared"),
    ])
  })

  test("invalid branches and file repositories are skipped", () => {
    expect(
      Agent.referencePaths(
        {
          references: {
            bad: { repository: "github.com/foo/bar", branch: "-bad" },
            file: "file:///tmp/repo",
          },
        },
        directory,
      ),
    ).toEqual([])
  })

  test("deprecated 'reference' key and empty config", () => {
    expect(
      Agent.referencePaths({ reference: { effect: "github.com/Effect-TS/effect-smol" } }, directory),
    ).toHaveLength(1)
    expect(Agent.referencePaths({}, directory)).toEqual([])
  })
})
