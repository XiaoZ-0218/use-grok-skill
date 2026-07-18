---
name: use-grok
description: Delegate code review, adversarial design critique, and implementation tasks to the Grok Build CLI (`grok`) from any agent. Use when the user wants a Grok second opinion, an independent review of working-tree or branch changes, a ship/no-ship risk critique before merging, or a task implemented by Grok.
---

# use-grok

`use-grok` is a CLI bridge to the Grok Build CLI. Every command accepts `--json` for machine parsing; exit code 0 means success, 1 means error or failed/cancelled run, 2 means unknown command.

## Setup

Run `use-grok check --json` first. It verifies Node, the `grok` binary (override with the `GROK_BINARY` env var), and authentication. If `ready` is `false`, tell the user to install or authenticate `grok` — do not retry other commands.

## Commands

- `use-grok ask "<prompt>"` — single-turn Q&A.
- `use-grok review [--scope auto|working-tree|branch] [--base <ref>]` — read-only code review. Auto scope reviews the working tree (staged, unstaged, and untracked changes) when it is dirty, otherwise the current branch against the default base branch.
- `use-grok critique [focus...]` — adversarial ship/no-ship critique with structured findings (severity, file and line range, confidence, recommendation). Best before merging or after a large change. Extra positional words become the focus topic.
- `use-grok run "<prompt>"` — delegate a task. Read-only by default (plan permission mode + read-only sandbox). Only pass `--write` when the user explicitly asked Grok to modify files.
- `use-grok runs [run-id] [--wait]`, `use-grok show [run-id]`, `use-grok stop [run-id]` — list, wait for, inspect, and stop background runs.

## Usage patterns

- Always pass `--json` when you need to act on the result, and parse stdout.
- Run from the repository root (or pass `--cwd <dir>`) so review scope and per-workspace run state resolve to the right place.
- For long operations use `--background`, then poll with `use-grok runs <run-id> --wait --json`, and read the output with `use-grok show <run-id> --json`. `review` and `critique` also accept `--background --wait` to block until the result is ready in one call.
- A stopped run is reported as `cancelled` and exits 1; a failed Grok invocation exits 1 with details on stderr.

## Safety

`review` and `critique` never modify the repository. `run` without `--write` cannot edit files either — treat `--write` as an explicit user decision, never a default.
