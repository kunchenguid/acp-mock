# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Project

`acp-mock` is a deterministic ACP (Agent Client Protocol) agent process used as a test double for ACP clients.
It speaks real ACP JSON-RPC over stdio via `@agentclientprotocol/sdk`, but emits scripted session updates instead of calling an LLM.
The package ships both as a CLI (`acp-mock`, entry `dist/cli.js`) and as a small library (`mockAgentArgs`, `mockAgentCommand`, `readJsonLines` from `dist/index.js`).

Node 20+, TypeScript, ESM-only.

## Commands

```sh
npm run build         # tsdown bundle of src/index.ts + src/cli.ts to dist/ with .d.ts
npm run dev           # tsdown --watch
npm test              # vitest run (one-shot)
npm run typecheck     # tsc -p tsconfig.json --noEmit
npm run lint          # eslint .
npm run format:check  # prettier --check .
npm run format        # prettier --write .
npm run check         # lint + format:check + typecheck + test + build
```

Run a single test file or filter:

```sh
npx vitest run test/cli.test.ts
npx vitest run -t "prints clean help"
```

The CLI tests in `test/cli.test.ts` spawn `src/cli.ts` directly via `node --import tsx`, so you do not need to `npm run build` before running tests.

## Architecture

Three source files, each with a distinct responsibility:

- `src/cli.ts` - Commander entrypoint. Parses flags into `AcpMockAgentOptions`, builds an `AgentSideConnection` over stdio using `ndJsonStream(Writable.toWeb(stdout), Readable.toWeb(stdin))`, and wires it to a fresh `AcpMockAgent`. Stdout is reserved for ACP NDJSON; lifecycle logging only happens when `--event-log` is set, and parse errors go to stderr with `process.exitCode = 2`.
- `src/mock-agent.ts` - The `AcpMockAgent` class implementing the `Agent` interface from the SDK (`initialize`, `authenticate`, `newSession`, `setSessionMode`, `prompt`, `cancel`). Per-session state lives in an in-memory `Map<SessionId, SessionState>` that tracks the session `cwd`, a `pendingPrompt: AbortController` so `cancel` can abort an in-flight `prompt`, and `usageUpdateCount` for cumulative usage updates. In scripted mode, `prompt` emits, in order: optional delay (abortable), optional usage update, optional N tool_call/tool_call_update pairs, optional file append into `session.cwd`, and finally an `agent_message_chunk`. If `--replay-runtime-events` is set, scripted updates are skipped and `replayTraceFile` translates a JSONL trace into `session/update` notifications via `traceEventToSessionUpdate` (handles `text_delta`, `status`/`usage_update`, and `tool_call`/`tool_call_update`, with `<cwd>` placeholder substitution), then optional file append still runs into `session.cwd`.
- `src/index.ts` - Pure helpers consumed by tests of downstream ACP clients. `mockAgentArgs(options)` produces a `string[]` of CLI flags, `mockAgentCommand(options)` produces a shell-escaped command string (uses `node <bin>` if `bin` ends in `.js`/`.mjs`), and `readJsonLines(contents)` parses a lifecycle log written by `--event-log`. The shared `AppendFileOptions`, `UsageUpdateMode`, and `MockAgentCommandOptions` types live here; `mock-agent.ts` imports `AppendFileOptions` and `UsageUpdateMode` from `./index.js`.

Key invariants to preserve when editing:

- Stdout is protocol-only. Never `console.log` from `mock-agent.ts` or `cli.ts` outside the ACP stream; route everything through `appendLog` (gated on `eventLogPath`) or stderr.
- Cancellation: `prompt` must `abort()` any prior controller before installing a new one, and the `catch` branch must check `controller.signal.aborted` to return `{ stopReason: "cancelled" }` instead of rethrowing.
- The `mockAgentArgs` flag list and the Commander definition in `cli.ts` must stay in sync, and both must match the README CLI table.

## Conventions

- Conventional Commits. `release-please` regenerates `CHANGELOG.md` and `.release-please-manifest.json` - never hand-edit those files.
- Human-authored PRs targeting `main` must be pushed through the [`no-mistakes`](https://github.com/kunchenguid/no-mistakes) gate (`git push no-mistakes`); a `Require no-mistakes` GitHub Actions check enforces the signature on PRs. Release-please and dependency bots are exempt.
- TDD for bug fixes and new features.
