<h1 align="center">acp-mock</h1>
<p align="center">
  <a href="https://github.com/kunchenguid/acp-mock/actions/workflows/ci.yml"
    ><img
      alt="CI"
      src="https://img.shields.io/github/actions/workflow/status/kunchenguid/acp-mock/ci.yml?style=flat-square&label=ci"
  /></a>
  <a href="https://www.npmjs.com/package/acp-mock"
    ><img alt="npm" src="https://img.shields.io/npm/v/acp-mock?style=flat-square"
  /></a>
  <a
    href="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square"
    ><img
      alt="Platform"
      src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=flat-square"
  /></a>
  <a href="https://x.com/kunchenguid"
    ><img
      alt="X"
      src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square"
  /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"
    ><img
      alt="Discord"
      src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord"
  /></a>
</p>

<h3 align="center">Test ACP clients E2E without spending tokens or trusting a live agent.</h3>

Real ACP integrations are annoying to test.
You want the full stdio protocol path, but you do not want flaky LLM behavior, burning real tokens, auth state, rate limits, or random tool output in CI.

`acp-mock` is a deterministic ACP-compatible agent process for end-to-end tests.
Point any ACP client at it, then assert on the exact session updates, logs, cancellation behavior, and workspace changes you asked it to produce.

- **Real protocol** - speaks ACP over stdio using `@agentclientprotocol/sdk`.
- **Deterministic turns** - emits fixed text, JSON, usage updates, tool calls, and workspace edits.
- **Trace replay** - replays normalized runtime JSONL events as ACP `session/update` notifications.

## Quick Start

```sh
$ npm install -D acp-mock

$ npx acp-mock --agent-message-json '{"success":true}' --usage-update-used 100
# stdio now speaks ACP JSON-RPC to the client
```

Use it from any ACP client configuration that accepts an agent command:

```json
{
  "agents": {
    "mock": {
      "command": "npx acp-mock --agent-message-json '{\"success\":true}'"
    }
  }
}
```

## Install

**npm**

```sh
npm install -D acp-mock
```

**From source**

```sh
git clone https://github.com/kunchenguid/acp-mock.git
cd acp-mock
npm install
npm run build
```

## How It Works

```
+------------+
| ACP client |
+-----+------+
      | JSON-RPC over stdio
      v
+------------+
| acp-mock   |
+-----+------+
      |
      +-- emit deterministic session/update events
      +-- append optional workspace changes
      +-- replay optional runtime traces
      +-- write optional JSONL lifecycle logs
```

- **Stdout is protocol-only** - normal runs write only ACP NDJSON to stdout.
- **Logs are opt-in** - pass `--event-log <path>` when tests need lifecycle assertions.
- **Traces are normalized** - pass `--replay-runtime-events <path>` with one runtime event per line.
- **Side effects are turn-level** - `--append-file` runs after a successful synthetic or replayed turn.

## CLI Reference

| Command    | Description                       |
| ---------- | --------------------------------- |
| `acp-mock` | Run an ACP mock agent over stdio. |

### Flags

| Flag                             | Description                                              |
| -------------------------------- | -------------------------------------------------------- |
| `--event-log <path>`             | Write lifecycle JSONL logs.                              |
| `--agent-message-json <json>`    | Emit this JSON object as an `agent_message_chunk`.       |
| `--agent-message <text>`         | Emit this text as an `agent_message_chunk`.              |
| `--replay-runtime-events <path>` | Replay normalized runtime events from JSONL.             |
| `--usage-update-used <tokens>`   | Emit a `usage_update` with this `used` count.            |
| `--usage-update-size <tokens>`   | Set the `usage_update` size.                             |
| `--usage-update-mode <mode>`     | Use `static` or `cumulative` usage values.               |
| `--tool-call-count <count>`      | Emit this many `tool_call` and `tool_call_update` pairs. |
| `--prompt-delay-ms <ms>`         | Delay the turn until cancelled or the timeout elapses.   |
| `--append-file <path>`           | Append text to a file relative to the session cwd.       |
| `--append-text <text>`           | Text to append when `--append-file` is set.              |

## Library Helpers

```ts
import { mockAgentArgs, mockAgentCommand, readJsonLines } from "acp-mock";

const command = mockAgentCommand({
  agentMessageJson: { success: true },
  usageUpdateUsed: 100,
  usageUpdateMode: "cumulative",
  toolCallCount: 3,
});
```

`mockAgentCommand()` is useful when a test needs to write an ACP client config override.
`mockAgentArgs()` is useful when a test spawns the binary directly.
`readJsonLines()` parses lifecycle logs written by `--event-log`.

## Development

```sh
npm run build # Build dist files
npm test # Run tests
npm run typecheck # Type-check source and tests
npm run lint # Run ESLint
npm run format:check # Check formatting
npm run check # Run all verification steps
```
