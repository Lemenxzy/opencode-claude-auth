import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")

const c = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
}

export interface SyncSummary {
  changed: boolean
  alreadyInSync: boolean
  updatedVersion: string | null
  updatedBetas: string[]
}

interface CommandResult {
  success: boolean
  stdout: string
  stderr: string
  detail: string
}

function runCommand(command: string, args: string[]): CommandResult {
  try {
    const stdout = execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { success: true, stdout, stderr: "", detail: "ok" }
  } catch (error: unknown) {
    const commandError = error as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      message?: string
      code?: string
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
      detail: commandError.message ?? commandError.code ?? "command failed",
    }
  }
}

function summarizeFailure(result: CommandResult): string {
  return (
    [result.stderr.trim(), result.stdout.trim(), result.detail].find(
      (value) => value.length > 0,
    ) ?? "command failed"
  )
}

function rollbackModelConfig(): void {
  const restoreResult = runCommand("git", [
    "checkout",
    "--",
    "src/model-config.ts",
  ])
  if (!restoreResult.success) {
    console.log(
      c.yellow(
        `Rollback warning: could not restore src/model-config.ts automatically (${summarizeFailure(restoreResult)})`,
      ),
    )
  }
}

export function parseInterceptUpdateOutput(output: string): SyncSummary {
  const alreadyInSync = output.includes(
    "Plugin defaults match Claude CLI. No changes needed.",
  )
  const changed = output.includes("Updated src/model-config.ts")

  const versionMatch = output.match(/ccVersion:\s+"([^"]+)"/)
  const betasMatch = output.match(/baseBetas:\s+\[([^\]]*)\]/)
  const updatedBetas = betasMatch
    ? betasMatch[1]
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : []

  return {
    changed,
    alreadyInSync,
    updatedVersion: versionMatch ? versionMatch[1] : null,
    updatedBetas,
  }
}

export function summarizeGitDiffStat(output: string): string {
  const trimmed = output.trim()
  return trimmed.length > 0 ? trimmed : "No file changes recorded."
}

function printStep(title: string): void {
  console.log(`\n${c.bold(title)}`)
}

async function main(): Promise<void> {
  console.log(c.bold("opencode-claude-auth sync"))
  console.log(c.dim(`Repository: ${REPO_ROOT}`))

  const fetchResult = runCommand("git", [
    "fetch",
    "--quiet",
    "--all",
    "--prune",
  ])
  if (!fetchResult.success) {
    console.log(
      c.yellow(`\nGit fetch warning: ${summarizeFailure(fetchResult)}`),
    )
  }

  const upstreamRef = runCommand("git", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ])
  if (upstreamRef.success) {
    const upstreamCounts = runCommand("git", [
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...${upstreamRef.stdout.trim()}`,
    ])
    if (upstreamCounts.success) {
      const [aheadRaw, behindRaw] = upstreamCounts.stdout.trim().split(/\s+/)
      const behind = Number.parseInt(behindRaw ?? "0", 10)
      if (behind > 0) {
        console.log(
          c.yellow(
            `\nUpstream notice: ${behind} newer commit${behind === 1 ? "" : "s"} available. Review them before merging local changes.`,
          ),
        )
      }
      const ahead = Number.parseInt(aheadRaw ?? "0", 10)
      if (ahead > 0) {
        console.log(
          c.dim(
            `Local branch is ${ahead} commit${ahead === 1 ? "" : "s"} ahead of upstream.`,
          ),
        )
      }
    }
  }

  printStep("1. Reconcile model-config with Claude CLI")
  const interceptResult = runCommand("node", [
    "--experimental-strip-types",
    "scripts/intercept-claude.ts",
    "--all",
    "--update",
  ])

  if (!interceptResult.success) {
    console.error(c.red(summarizeFailure(interceptResult)))
    process.exit(1)
  }

  const interceptSummary = parseInterceptUpdateOutput(interceptResult.stdout)
  if (interceptSummary.alreadyInSync) {
    console.log(c.green("Already in sync with the installed Claude CLI."))
    process.exit(0)
  }

  if (!interceptSummary.changed) {
    console.log(
      c.yellow("Intercept completed, but no writable changes were detected."),
    )
    process.exit(2)
  }

  console.log(
    c.green("Updated src/model-config.ts from live Claude CLI traffic."),
  )
  if (interceptSummary.updatedVersion) {
    console.log(c.dim(`  ccVersion -> ${interceptSummary.updatedVersion}`))
  }
  if (interceptSummary.updatedBetas.length > 0) {
    console.log(
      c.dim(`  baseBetas -> ${interceptSummary.updatedBetas.join(", ")}`),
    )
  }

  printStep("2. Rebuild")
  const buildResult = runCommand("pnpm", ["run", "build"])
  if (!buildResult.success) {
    rollbackModelConfig()
    console.error(c.red(summarizeFailure(buildResult)))
    process.exit(1)
  }
  console.log(c.green("Build passed."))

  printStep("3. Test")
  const testResult = runCommand("pnpm", ["test"])
  if (!testResult.success) {
    rollbackModelConfig()
    console.error(c.red(summarizeFailure(testResult)))
    process.exit(1)
  }
  console.log(c.green("Tests passed."))

  printStep("4. Lint")
  const lintResult = runCommand("pnpm", ["run", "lint"])
  if (!lintResult.success) {
    rollbackModelConfig()
    console.error(c.red(summarizeFailure(lintResult)))
    process.exit(1)
  }
  console.log(c.green("Lint passed."))

  printStep("5. Review changed files")
  const diffStat = runCommand("git", ["diff", "--stat"])
  console.log(summarizeGitDiffStat(diffStat.stdout))

  console.log(`\n${c.bold("Summary")}: ${c.green("sync complete")}`)
  console.log(
    c.cyan(
      "Next step: inspect the diff, then restart OpenCode and run a real Claude request.",
    ),
  )
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
