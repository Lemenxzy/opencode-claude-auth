# Maintenance Guide

This document explains how to keep your local fork of `opencode-claude-auth` healthy and up-to-date. It covers daily health checks, Claude Code upgrades, upstream sync, and troubleshooting.

## Repository Layout

```
~/Documents/opencode-claude-auth2/          ← Your fork (long-term maintenance repo)
├── origin    → github.com/Lemenxzy/opencode-claude-auth.git   (your fork)
├── upstream  → github.com/griffinmartin/opencode-claude-auth.git (official)
└── OpenCode loads from: file:///…/opencode-claude-auth2/opencode-claude-auth.js
```

The old `~/Documents/opencode-claude-auth/` is a reference copy of the official repo. **Do not use it for day-to-day maintenance.**

## Quick Reference

| What happened                 | What to run                                     |
| ----------------------------- | ----------------------------------------------- |
| Routine check                 | `pnpm run doctor`                               |
| Claude Code upgraded          | `pnpm run sync`                                 |
| Official repo has new commits | `git fetch upstream && git merge upstream/main` |
| Something broke               | `pnpm run doctor` → follow the output           |
| Want to push your changes     | `git push origin main`                          |

## Commands

### `pnpm run doctor`

One-command health check. Runs the following checks in order:

1. **Build** — `tsc` compiles without errors
2. **Credentials** — Claude Code OAuth credentials are readable from Keychain
3. **Claude version** — `ccVersion` in config matches installed `claude --version`
4. **Tests** — Full test suite passes (235 tests)
5. **Lint** — oxlint + oxfmt pass
6. **Claude CLI drift** — Runs `intercept` to compare plugin defaults with real Claude CLI traffic
7. **OpenCode plugin wiring** — Verifies `opencode.json` points to this local repo
8. **Git upstream** — Checks if you're behind the official repo

**Exit codes:**

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| 0    | `healthy` — everything is fine                             |
| 2    | `drift detected` — something changed but nothing is broken |
| 1    | `broken` — build, tests, or credentials have a problem     |

**Example output:**

```
✓ Build: TypeScript build succeeded
✓ Claude credentials: Found 1 Claude account
✓ Claude version: Config matches installed Claude 2.1.98
✓ Tests: Test suite passed
✓ Lint: Lint checks passed
✓ Claude CLI drift: Plugin defaults match the installed Claude CLI
✓ OpenCode plugin wiring: OpenCode is wired to this local repository
✓ Git upstream: Local branch is in sync with its upstream ref

Summary: healthy
```

### `pnpm run sync`

One-command drift reconciliation. Does the following:

1. `git fetch --all` to check for upstream changes
2. Runs `intercept --all --update` — captures live Claude CLI traffic and auto-updates `src/model-config.ts`
3. Rebuilds (`pnpm run build`)
4. Runs tests (`pnpm test`)
5. Runs lint (`pnpm run lint`)
6. Shows `git diff --stat` so you can review what changed

**Safety:** If build, test, or lint fails after updating `model-config.ts`, sync automatically rolls back the file to its previous state. Your repo is never left broken.

**If sync reports "Already in sync":** Nothing needs to change — your plugin already matches the installed Claude CLI.

## Scenarios

### Scenario 1: Routine Health Check

Run this whenever you want to verify things are working:

```bash
cd ~/Documents/opencode-claude-auth2
pnpm run doctor
```

If the result is `healthy`, you're done. If it reports `drift detected`, run `pnpm run sync`.

### Scenario 2: Claude Code Got Upgraded

After upgrading Claude Code (e.g. `2.1.98` → `2.2.x`):

```bash
cd ~/Documents/opencode-claude-auth2
pnpm run sync
pnpm run doctor
```

`sync` will detect the new version and update `ccVersion`, betas, and headers automatically. Then `doctor` confirms everything is green.

After sync completes, **restart OpenCode** to pick up the rebuilt plugin.

### Scenario 3: Official Repo Has New Commits

When the upstream `griffinmartin/opencode-claude-auth` repo gets new commits (bug fixes, new features, PR #207 merged, etc.):

```bash
cd ~/Documents/opencode-claude-auth2
git fetch upstream
git merge upstream/main
pnpm install        # in case dependencies changed
pnpm run doctor
```

If you prefer linear history:

```bash
git rebase upstream/main
```

If there are merge conflicts, resolve them manually, then re-run `pnpm run doctor`.

### Scenario 4: PR #207 Gets Merged and Published to npm

Once the official npm package catches up, you can optionally switch back:

1. Edit `~/.config/opencode/opencode.json`
2. Replace `"file:///Users/xuzhiyuan/Documents/opencode-claude-auth2/opencode-claude-auth.js"` with `"opencode-claude-auth@latest"`
3. Restart OpenCode

You can always switch back to the local fork by reversing this change.

### Scenario 5: Something Broke

```bash
cd ~/Documents/opencode-claude-auth2
pnpm run doctor
```

Read the output — it tells you exactly what failed. Common fixes:

| Doctor says                                     | Fix                                                           |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `Build: failed`                                 | Check `src/` for syntax errors, run `pnpm run build` manually |
| `Claude credentials: failed`                    | Run `claude` in terminal to re-authenticate                   |
| `Claude version: Config targets X, installed Y` | Run `pnpm run sync`                                           |
| `Claude CLI drift: drift detected`              | Run `pnpm run sync`                                           |
| `OpenCode plugin wiring: npm plugin`            | Edit `opencode.json` to use `file://` path                    |
| `Git upstream: N newer commits`                 | `git fetch upstream && git merge upstream/main`               |

## File Structure

```
scripts/
├── doctor.ts           ← Health check script
├── doctor.test.ts      ← Unit tests for doctor helpers
├── sync.ts             ← Drift reconciliation script
├── sync.test.ts        ← Unit tests for sync helpers
├── intercept-claude.ts ← Claude CLI traffic interceptor (also used by doctor/sync)
├── test-models.ts      ← Live model validation
└── validate-oauth-refresh.ts ← OAuth token refresh validation
```

## OpenCode Configuration

Your `~/.config/opencode/opencode.json` should contain:

```json
{
  "plugin": [
    "file:///Users/xuzhiyuan/Documents/opencode-claude-auth2/opencode-claude-auth.js"
  ]
}
```

The `doctor` command automatically checks this and warns if the wiring is wrong.

## Git Remotes

```
origin   → https://github.com/Lemenxzy/opencode-claude-auth.git   (your fork)
upstream → https://github.com/griffinmartin/opencode-claude-auth.git (official)
```

To verify:

```bash
git remote -v
```

## Pushing Your Changes

After making local changes (e.g. after `sync` updates model-config):

```bash
git add -A
git commit -m "chore: sync model-config with Claude CLI X.Y.Z"
git push origin main
```

## Environment Variable Overrides

If Anthropic changes something before you can run `sync`, you can use environment variables as an emergency override:

| Variable                      | What it does                            |
| ----------------------------- | --------------------------------------- |
| `ANTHROPIC_CLI_VERSION`       | Override ccVersion                      |
| `ANTHROPIC_USER_AGENT`        | Override full User-Agent string         |
| `ANTHROPIC_BETA_FLAGS`        | Override beta flags (comma-separated)   |
| `ANTHROPIC_ENABLE_1M_CONTEXT` | Enable 1M context window (requires Max) |

Example:

```bash
export ANTHROPIC_CLI_VERSION=2.2.0
```
