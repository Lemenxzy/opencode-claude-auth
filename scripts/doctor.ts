import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const OPENCODE_CONFIG_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "opencode.json",
)
const LOCAL_PLUGIN_URL = pathToFileURL(
  join(REPO_ROOT, "opencode-claude-auth.js"),
).href

const c = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
}

export type CheckStatus = "pass" | "warn" | "fail"

export interface CheckResult {
  name: string
  status: CheckStatus
  detail: string
}

export interface DoctorReport {
  results: CheckResult[]
  overallStatus: CheckStatus
  exitCode: number
}

interface CommandResult {
  success: boolean
  stdout: string
  stderr: string
  status: number
  detail: string
}

function runCommand(command: string, args: string[]): CommandResult {
  try {
    const stdout = execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return {
      success: true,
      stdout,
      stderr: "",
      status: 0,
      detail: "ok",
    }
  } catch (error: unknown) {
    const commandError = error as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      status?: number
      code?: string
      message?: string
    }
    const stdout =
      typeof commandError.stdout === "string"
        ? commandError.stdout
        : Buffer.isBuffer(commandError.stdout)
          ? commandError.stdout.toString("utf-8")
          : ""
    const stderr =
      typeof commandError.stderr === "string"
        ? commandError.stderr
        : Buffer.isBuffer(commandError.stderr)
          ? commandError.stderr.toString("utf-8")
          : ""

    return {
      success: false,
      stdout,
      stderr,
      status: commandError.status ?? 1,
      detail: commandError.message ?? commandError.code ?? "command failed",
    }
  }
}

function summarizeCommandFailure(result: CommandResult): string {
  const output = [result.stderr.trim(), result.stdout.trim(), result.detail]
    .find((value) => value.length > 0)
    ?.replace(/\s+/g, " ")
  return output ?? `command failed with exit ${result.status}`
}

export function parseClaudeVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/)
  return match ? match[1] : null
}

export function inspectPluginConfig(
  configText: string,
  expectedPluginUrl: string,
): CheckResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(configText)
  } catch {
    return {
      name: "OpenCode plugin wiring",
      status: "fail",
      detail: "opencode.json is not valid JSON",
    }
  }

  const pluginValue = (parsed as { plugin?: unknown }).plugin
  if (!Array.isArray(pluginValue)) {
    return {
      name: "OpenCode plugin wiring",
      status: "warn",
      detail: "opencode.json has no plugin array",
    }
  }

  const plugins = new Set(
    pluginValue.filter((value): value is string => typeof value === "string"),
  )

  if (plugins.has(expectedPluginUrl)) {
    return {
      name: "OpenCode plugin wiring",
      status: "pass",
      detail: "OpenCode is wired to this local repository",
    }
  }

  if (plugins.has("opencode-claude-auth@latest")) {
    return {
      name: "OpenCode plugin wiring",
      status: "warn",
      detail: "OpenCode is using the npm plugin, not this local repository",
    }
  }

  return {
    name: "OpenCode plugin wiring",
    status: "warn",
    detail: "OpenCode is not configured to load this plugin",
  }
}

export function summarizeInterceptOutput(output: string): CheckResult {
  if (output.includes("Plugin defaults match Claude CLI. No changes needed.")) {
    return {
      name: "Claude CLI drift",
      status: "pass",
      detail: "Plugin defaults match the installed Claude CLI",
    }
  }

  if (
    output.includes("Run with --update to apply these changes") ||
    output.includes("Updated src/model-config.ts")
  ) {
    return {
      name: "Claude CLI drift",
      status: "warn",
      detail: "Claude CLI drift detected; run `pnpm run sync`",
    }
  }

  if (output.includes("Claude CLI not found")) {
    return {
      name: "Claude CLI drift",
      status: "fail",
      detail: "Claude CLI is not installed or not on PATH",
    }
  }

  return {
    name: "Claude CLI drift",
    status: "warn",
    detail: "Could not determine drift status from intercept output",
  }
}

export function summarizeUpstreamStatus(output: string): CheckResult {
  const trimmed = output.trim()
  if (!trimmed) {
    return {
      name: "Git upstream",
      status: "warn",
      detail: "No upstream configured for this repository",
    }
  }

  const match = trimmed.match(/^(\d+)\s+(\d+)$/)
  if (!match) {
    return {
      name: "Git upstream",
      status: "warn",
      detail: "Could not parse upstream status",
    }
  }

  const ahead = Number.parseInt(match[1], 10)
  const behind = Number.parseInt(match[2], 10)

  if (behind > 0) {
    return {
      name: "Git upstream",
      status: "warn",
      detail: `Upstream has ${behind} newer commit${behind === 1 ? "" : "s"}`,
    }
  }

  if (ahead > 0) {
    return {
      name: "Git upstream",
      status: "pass",
      detail: `Local branch is ${ahead} commit${ahead === 1 ? "" : "s"} ahead of upstream`,
    }
  }

  return {
    name: "Git upstream",
    status: "pass",
    detail: "Local branch is in sync with its upstream ref",
  }
}

function getOverallStatus(results: CheckResult[]): CheckStatus {
  if (results.some((result) => result.status === "fail")) return "fail"
  if (results.some((result) => result.status === "warn")) return "warn"
  return "pass"
}

function getExitCode(status: CheckStatus): number {
  switch (status) {
    case "pass":
      return 0
    case "warn":
      return 2
    case "fail":
      return 1
  }
}

async function checkCredentials(): Promise<CheckResult> {
  try {
    const keychainModule = (await import("../dist/keychain.js")) as {
      readAllClaudeAccounts: () => Array<{ label: string }>
    }
    const accounts = keychainModule.readAllClaudeAccounts()
    if (accounts.length === 0) {
      return {
        name: "Claude credentials",
        status: "fail",
        detail: "No Claude Code OAuth credentials found",
      }
    }
    return {
      name: "Claude credentials",
      status: "pass",
      detail: `Found ${accounts.length} Claude account${accounts.length === 1 ? "" : "s"}`,
    }
  } catch (error: unknown) {
    return {
      name: "Claude credentials",
      status: "fail",
      detail:
        error instanceof Error ? error.message : "Failed to read credentials",
    }
  }
}

async function checkConfigVersion(): Promise<CheckResult> {
  try {
    const modelConfigModule = (await import("../dist/model-config.js")) as {
      config: { ccVersion: string }
    }
    const claudeVersion = runCommand("claude", ["--version"])

    if (!claudeVersion.success) {
      return {
        name: "Claude version",
        status: "fail",
        detail: summarizeCommandFailure(claudeVersion),
      }
    }

    const installedVersion = parseClaudeVersion(claudeVersion.stdout)
    if (!installedVersion) {
      return {
        name: "Claude version",
        status: "warn",
        detail: "Could not parse `claude --version` output",
      }
    }

    if (installedVersion !== modelConfigModule.config.ccVersion) {
      return {
        name: "Claude version",
        status: "warn",
        detail: `Config targets ${modelConfigModule.config.ccVersion}, installed Claude is ${installedVersion}`,
      }
    }

    return {
      name: "Claude version",
      status: "pass",
      detail: `Config matches installed Claude ${installedVersion}`,
    }
  } catch (error: unknown) {
    return {
      name: "Claude version",
      status: "fail",
      detail:
        error instanceof Error ? error.message : "Failed to read model config",
    }
  }
}

function checkBuild(): CheckResult {
  const result = runCommand("pnpm", ["run", "build"])
  return result.success
    ? { name: "Build", status: "pass", detail: "TypeScript build succeeded" }
    : {
        name: "Build",
        status: "fail",
        detail: summarizeCommandFailure(result),
      }
}

function checkTests(): CheckResult {
  const result = runCommand("pnpm", ["test"])
  return result.success
    ? { name: "Tests", status: "pass", detail: "Test suite passed" }
    : {
        name: "Tests",
        status: "fail",
        detail: summarizeCommandFailure(result),
      }
}

function checkLint(): CheckResult {
  const result = runCommand("pnpm", ["run", "lint"])
  return result.success
    ? { name: "Lint", status: "pass", detail: "Lint checks passed" }
    : {
        name: "Lint",
        status: "fail",
        detail: summarizeCommandFailure(result),
      }
}

function checkIntercept(): CheckResult {
  const result = runCommand("node", [
    "--experimental-strip-types",
    "scripts/intercept-claude.ts",
  ])

  if (!result.success) {
    return {
      name: "Claude CLI drift",
      status: "fail",
      detail: summarizeCommandFailure(result),
    }
  }

  return summarizeInterceptOutput(result.stdout)
}

function checkOpencodeConfig(): CheckResult {
  if (!existsSync(OPENCODE_CONFIG_PATH)) {
    return {
      name: "OpenCode plugin wiring",
      status: "warn",
      detail: `OpenCode config not found at ${OPENCODE_CONFIG_PATH}`,
    }
  }

  const configText = readFileSync(OPENCODE_CONFIG_PATH, "utf-8")
  return inspectPluginConfig(configText, LOCAL_PLUGIN_URL)
}

function checkGitUpstream(): CheckResult {
  const upstreamRef = runCommand("git", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ])

  if (!upstreamRef.success) {
    return {
      name: "Git upstream",
      status: "warn",
      detail: "No upstream configured for this repository",
    }
  }

  const counts = runCommand("git", [
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${upstreamRef.stdout.trim()}`,
  ])

  if (!counts.success) {
    return {
      name: "Git upstream",
      status: "warn",
      detail: summarizeCommandFailure(counts),
    }
  }

  return summarizeUpstreamStatus(counts.stdout)
}

function printResult(result: CheckResult): void {
  const icon =
    result.status === "pass"
      ? c.green("✓")
      : result.status === "warn"
        ? c.yellow("!")
        : c.red("✗")
  console.log(`${icon} ${c.bold(result.name)}: ${result.detail}`)
}

export async function runDoctor(): Promise<DoctorReport> {
  const results: CheckResult[] = []

  results.push(checkBuild())

  const buildResult = results[results.length - 1]

  if (buildResult?.status !== "fail") {
    results.push(await checkCredentials())
    results.push(await checkConfigVersion())
    results.push(checkTests())
    results.push(checkLint())
    results.push(checkIntercept())
    results.push(checkOpencodeConfig())
    results.push(checkGitUpstream())
  }

  const overallStatus = getOverallStatus(results)
  return {
    results,
    overallStatus,
    exitCode: getExitCode(overallStatus),
  }
}

async function main(): Promise<void> {
  console.log(c.bold("opencode-claude-auth doctor"))
  console.log(c.dim(`Repository: ${REPO_ROOT}`))
  console.log(c.dim(`Expected plugin URL: ${LOCAL_PLUGIN_URL}`))
  console.log("")

  const report = await runDoctor()

  for (const result of report.results) {
    printResult(result)
  }

  const summaryText =
    report.overallStatus === "pass"
      ? c.green("healthy")
      : report.overallStatus === "warn"
        ? c.yellow("drift detected")
        : c.red("broken")

  console.log(`\n${c.bold("Summary")}: ${summaryText}`)
  if (report.overallStatus === "warn") {
    console.log(
      c.cyan("Next step: run `pnpm run sync` if you want to reconcile drift."),
    )
  }

  process.exit(report.exitCode)
}

const isDirectRun =
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/.*\//, ""))

if (isDirectRun) {
  main().catch((error) => {
    console.error(c.red(error instanceof Error ? error.message : String(error)))
    process.exit(1)
  })
}
