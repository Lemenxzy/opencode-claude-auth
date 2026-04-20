import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  inspectPluginConfig,
  parseClaudeVersion,
  summarizeInterceptOutput,
  summarizeUpstreamStatus,
} from "./doctor.ts"

describe("parseClaudeVersion", () => {
  it("extracts a semantic version from output", () => {
    assert.equal(parseClaudeVersion("Claude Code 2.1.98\n"), "2.1.98")
  })

  it("returns null when no version is present", () => {
    assert.equal(parseClaudeVersion("unknown output"), null)
  })
})

describe("inspectPluginConfig", () => {
  const expectedPluginUrl = "file:///tmp/opencode-claude-auth.js"

  it("passes when the local plugin is configured", () => {
    const result = inspectPluginConfig(
      JSON.stringify({ plugin: [expectedPluginUrl] }),
      expectedPluginUrl,
    )

    assert.equal(result.status, "pass")
  })

  it("warns when only the npm plugin is configured", () => {
    const result = inspectPluginConfig(
      JSON.stringify({ plugin: ["opencode-claude-auth@latest"] }),
      expectedPluginUrl,
    )

    assert.equal(result.status, "warn")
    assert.match(result.detail, /npm plugin/)
  })

  it("fails for invalid JSON", () => {
    const result = inspectPluginConfig("{not-json", expectedPluginUrl)
    assert.equal(result.status, "fail")
  })
})

describe("summarizeInterceptOutput", () => {
  it("passes when no changes are needed", () => {
    const result = summarizeInterceptOutput(
      "Plugin defaults match Claude CLI. No changes needed.",
    )
    assert.equal(result.status, "pass")
  })

  it("warns when drift is detected", () => {
    const result = summarizeInterceptOutput(
      "Run with --update to apply these changes to src/model-config.ts",
    )
    assert.equal(result.status, "warn")
  })

  it("fails when claude is missing", () => {
    const result = summarizeInterceptOutput(
      "Claude CLI not found. Install it first.",
    )
    assert.equal(result.status, "fail")
  })
})

describe("summarizeUpstreamStatus", () => {
  it("passes when local branch matches upstream", () => {
    const result = summarizeUpstreamStatus("0 0\n")
    assert.equal(result.status, "pass")
  })

  it("warns when upstream is ahead", () => {
    const result = summarizeUpstreamStatus("0 3\n")
    assert.equal(result.status, "warn")
    assert.match(result.detail, /3 newer commits/)
  })
})
