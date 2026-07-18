# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- `SKILL.md` so the package can be installed as an agent skill.
- `review` and `critique` honor `--wait` together with `--background`: block until the run finishes and print the final result.
- Working-tree review context now includes staged changes and untracked file contents (previously only unstaged tracked diffs, so freshly `git add`-ed files were reviewed as an empty diff).
- Tests for `critique`, background job completion and stop, and staged/untracked review context.

### Fixed

- `stop --json` printed a bare string instead of structured JSON; it now returns a `{ status, runId, stopped }` object like the other commands.
- `terminateProcessTree` spin-waited synchronously for up to 500ms after SIGTERM, blocking the event loop; it now polls asynchronously and `stopJob`/`stop` await it.
- `runCommandAsync` timeouts appended "timed out" to stderr after the promise had already settled (silently dropping the message) and could resolve with `status: null`; the timeout note is now appended before settling and timeouts resolve with a definite failure status (124).
- `withStateLock` retried lock acquisition with a CPU-burning empty `while` loop; it now sleeps via `Atomics.wait`, which Node.js permits on the main thread.
- The state directory (default under `$TMPDIR`) was world-readable, exposing job prompts and outputs to other users on the machine; it is now created — and re-tightened on every access — with `0o700` permissions (best-effort on platforms without POSIX permissions, e.g. Windows).
- Per-job files (`jobs/<id>.json`) were written at enqueue time and never updated, so the final result only existed in `state.json`; the run worker now writes the terminal status and result back to the per-job file on completion, keeping both stores consistent for `show`.
- Background jobs never executed: the worker spawned `src/cli.mjs`, which has no self-executing entry, via a percent-encoded `URL.pathname`. It now spawns `bin/use-grok.mjs` resolved through `fileURLToPath`.
- `use-grok check` printed raw JSON in human mode; it now renders the human-readable setup report.
- `parseStructuredOutput` failed on nested pretty-printed JSON.
- Headless Grok invocations no longer block the event loop, and spawn errors/timeouts are surfaced on stderr instead of failing silently.
- Removed unused imports and dead exports.

## [0.1.0] - 2026-07-17

### Added

- Initial release of `use-grok`.
- Commands: `check`, `ask`, `review`, `critique`, `run`, `runs`, `show`, `stop`.
- Background job tracking with per-workspace JSON state store.
- Cross-platform process tree termination.
- Zero runtime dependencies; uses only Node.js stdlib.
- Tests with Node built-in test runner and fake `grok` fixture.
