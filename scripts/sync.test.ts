import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseInterceptUpdateOutput, summarizeGitDiffStat } from "./sync.ts"

describe("parseInterceptUpdateOutput", () => {
  it("reports already-in-sync output", () => {
    const result = parseInterceptUpdateOutput(
      "Plugin defaults match Claude CLI. No changes needed.",
    )

    assert.equal(result.alreadyInSync, true)
    assert.equal(result.changed, false)
  })

  it("reports updated config output", () => {
    const result = parseInterceptUpdateOutput(`Updated src/model-config.ts
    baseBetas: [alpha, bravo]
    ccVersion: "2.2.0"`)

    assert.equal(result.changed, true)
    assert.equal(result.updatedVersion, "2.2.0")
    assert.deepEqual(result.updatedBetas, ["alpha", "bravo"])
  })
})

describe("summarizeGitDiffStat", () => {
  it("returns a friendly fallback for empty diff output", () => {
    assert.equal(summarizeGitDiffStat("   \n"), "No file changes recorded.")
  })

  it("preserves non-empty diff output", () => {
    assert.equal(
      summarizeGitDiffStat(" src/model-config.ts | 4 ++--\n"),
      "src/model-config.ts | 4 ++--",
    )
  })
})
