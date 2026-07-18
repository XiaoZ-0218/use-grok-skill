# use-grok

**English** | [简体中文](./README.zh-CN.md)

Agent-agnostic CLI bridge to the [Grok Build CLI](https://x.ai) (`grok`).

`use-grok` lets any AI agent, IDE extension, shell script, or CI pipeline call Grok for code review, design critique, and delegated implementation — without requiring Claude Code or any specific editor plugin.

> Inspired by the [`grok-build-plugin-cc`](https://github.com/xai-org/grok-build-plugin-cc) Claude Code plugin. This package takes the same core ideas and exposes them as a plain `npx use-grok` command that works everywhere.

## Requirements

- Node.js `>= 18.18`
- Grok Build CLI (`grok`) on your `PATH`, or set `GROK_BINARY`
- A logged-in Grok CLI session (`grok models` succeeds)

## Installation

```bash
# Run without installing
npx use-grok check

# Or install globally
npm install -g use-grok
use-grok check
```

## Quick start

```bash
# Check that Node + Grok CLI are ready
use-grok check

# Ask Grok a single question
use-grok ask "Explain this codebase to me"

# Review uncommitted changes
use-grok review --scope working-tree

# Critique the current branch against main
use-grok critique --base main

# Delegate a task to Grok (read-only by default)
use-grok run "Fix the flaky test in auth"

# Allow Grok to edit files
use-grok run "Apply the top fix" --write
```

## Commands

### `use-grok check [--json]`

Probe Node, Grok CLI, and authentication readiness.

### `use-grok ask <prompt> [--model <model>] [--effort low|medium|high] [--json]`

Single-turn ask. Returns Grok's plain-text response (or JSON with `--json`).

### `use-grok review [--wait] [--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort low|medium|high] [--json]`

Read-only review of local git state. Defaults to the working tree if there are uncommitted changes, otherwise the current branch versus the default base. The working-tree scope covers staged, unstaged, and untracked changes.

### `use-grok critique [--wait] [--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <model>] [--effort low|medium|high] [--json] [focus...]`

Adversarial design/risk critique with structured JSON output when possible. Any extra positional arguments become the focus topic.

### `use-grok run <prompt> [--background] [--write] [--model <model>] [--effort low|medium|high] [--json]`

Delegate a task to Grok. By default the run is read-only (`--permission-mode plan --sandbox read-only`). Pass `--write` to let Grok edit files.

### `use-grok runs [run-id] [--wait] [--json]`

List active and recent runs, or wait for a specific run to finish.

### `use-grok show [run-id] [--json]`

Show stored output for a finished run.

### `use-grok stop [run-id] [--json]`

Stop an active run and its tracked process tree.

## Environment variables

| Variable | Purpose |
|---|---|
| `GROK_BINARY` | Path to the `grok` executable (defaults to `grok` on `PATH`) |
| `USE_GROK_SESSION_ID` | Optional session id used to scope background jobs |
| `USE_GROK_STATE_DIR` | Override the directory used for run state (defaults to `$TMPDIR/use-grok-runs/...`) |
| `TMPDIR` | Used to derive the default state directory |

## Background jobs

Long-running `review`, `critique`, and `run` commands can be queued in the background with `--background`. The CLI stores job metadata and logs under the workspace state directory and you can manage them with `runs`, `show`, and `stop`. For `review` and `critique`, adding `--wait` blocks until the background run finishes and prints the final result.

## Agent skill

This repository doubles as an agent skill: [SKILL.md](./SKILL.md) contains the usage instructions an agent needs to drive the CLI. Copy or symlink this directory into your agent's skills path (for example `~/.agents/skills/use-grok/`) to register it.

## JSON output

Pass `--json` to any command to receive machine-parseable output. This is especially useful when `use-grok` is invoked by another agent that needs to act on the result.

## Exit codes

- `0` — success
- `1` — error, failed run, or cancelled run
- `2` — unknown command

## Development

```bash
git clone <your-repo-url>
cd use-grok
npm test
```

Tests use Node's built-in test runner and a fake `grok` binary, so they do not require a real Grok account.

## Acknowledgments

This project is inspired by [`grok-build-plugin-cc`](https://github.com/xai-org/grok-build-plugin-cc), the official Claude Code plugin for Grok Build. `use-grok` reuses its high-level patterns (read-only review, structured critique, tracked background jobs) but repackages them as a general-purpose CLI.

## License

Apache-2.0. See [LICENSE](./LICENSE).
