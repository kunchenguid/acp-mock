import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import * as acp from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { readJsonLines } from "../src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "src", "cli.ts");

class RecordingClient implements acp.Client {
  readonly updates: acp.SessionNotification[] = [];

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this.updates.push(params);
  }

  async requestPermission(): Promise<acp.RequestPermissionResponse> {
    return { outcome: { outcome: "cancelled" } };
  }
}

function spawnMock(args: string[]): ChildProcess {
  return spawn(process.execPath, ["--import", "tsx", cliPath, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function connect(child: ChildProcess): Promise<{
  connection: acp.ClientSideConnection;
  client: RecordingClient;
}> {
  const input = Writable.toWeb(child.stdin!);
  const output = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
  const client = new RecordingClient();
  const stream = acp.ndJsonStream(input, output);
  const connection = new acp.ClientSideConnection(() => client, stream);
  await connection.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
    },
  });
  return { connection, client };
}

describe("acp mock agent", () => {
  const tempDirs: string[] = [];
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) {
      child.kill("SIGTERM");
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs a deterministic turn with usage, tool calls, workspace changes, and JSONL logs", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-mock-cwd-"));
    const logPath = join(cwd, "mock.jsonl");
    tempDirs.push(cwd);
    writeFileSync(join(cwd, "README.md"), "# fixture\n", "utf-8");

    const child = spawnMock([
      "--event-log",
      logPath,
      "--agent-message-json",
      '{"success":true,"summary":"mock complete"}',
      "--usage-update-used",
      "150",
      "--tool-call-count",
      "2",
      "--append-file",
      "README.md",
      "--append-text",
      "- changed by acp-mock\n",
    ]);
    children.push(child);

    const { connection, client } = await connect(child);
    const session = await connection.newSession({ cwd, mcpServers: [] });
    const result = await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "ship it" }],
    });

    expect(result.stopReason).toBe("end_turn");
    expect(readFileSync(join(cwd, "README.md"), "utf-8")).toContain(
      "changed by acp-mock",
    );

    const updates = client.updates.map((entry) => entry.update);
    expect(updates).toContainEqual({
      sessionUpdate: "usage_update",
      used: 150,
      size: 200000,
    });
    expect(
      updates.filter((update) => update.sessionUpdate === "tool_call"),
    ).toHaveLength(2);
    expect(
      updates.filter((update) => update.sessionUpdate === "tool_call_update"),
    ).toHaveLength(2);
    expect(updates.at(-1)).toEqual({
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text: '{"success":true,"summary":"mock complete"}',
      },
    });

    const logEvents = readJsonLines(readFileSync(logPath, "utf-8")).map(
      (entry) => entry.event,
    );
    expect(logEvents).toEqual([
      "process:ready",
      "agent:initialize",
      "agent:newSession",
      "agent:prompt:start",
      "agent:prompt:usage",
      "agent:prompt:tool-calls",
      "workspace:changed",
      "agent:prompt:done",
    ]);
  });

  it("cancels an in-flight turn", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-mock-cancel-"));
    const logPath = join(cwd, "mock.jsonl");
    tempDirs.push(cwd);

    const child = spawnMock([
      "--event-log",
      logPath,
      "--prompt-delay-ms",
      "30000",
    ]);
    children.push(child);

    const { connection } = await connect(child);
    const session = await connection.newSession({ cwd, mcpServers: [] });
    const promptResult = connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "wait" }],
    });

    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    await connection.cancel({ sessionId: session.sessionId });

    await expect(promptResult).resolves.toEqual({ stopReason: "cancelled" });
    const logEvents = readJsonLines(readFileSync(logPath, "utf-8")).map(
      (entry) => entry.event,
    );
    expect(logEvents).toContain("agent:cancel");
    expect(logEvents).toContain("agent:prompt:cancelled");
  });

  it("replays normalized acpx runtime trace events as ACP session updates", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "acp-mock-trace-"));
    const tracePath = join(cwd, "trace.jsonl");
    tempDirs.push(cwd);
    writeFileSync(
      tracePath,
      [
        JSON.stringify({
          type: "text_delta",
          stream: "thought",
          text: "thinking",
        }),
        JSON.stringify({
          type: "text_delta",
          stream: "output",
          text: "cwd=<cwd>",
        }),
        JSON.stringify({
          type: "status",
          tag: "usage_update",
          used: 42,
          size: 100,
        }),
        JSON.stringify({
          type: "tool_call",
          tag: "tool_call",
          toolCallId: "tool-1",
          title: "Read <cwd>",
          status: "pending",
        }),
        JSON.stringify({
          type: "tool_call",
          tag: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
        }),
      ].join("\n"),
      "utf-8",
    );

    const child = spawnMock(["--replay-runtime-events", tracePath]);
    children.push(child);

    const { connection, client } = await connect(child);
    const session = await connection.newSession({ cwd, mcpServers: [] });
    const result = await connection.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "replay" }],
    });

    expect(result.stopReason).toBe("end_turn");
    expect(client.updates.map((entry) => entry.update)).toEqual([
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking" },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `cwd=${cwd}` },
      },
      { sessionUpdate: "usage_update", used: 42, size: 100 },
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        kind: "other",
        title: `Read ${cwd}`,
        status: "pending",
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
      },
    ]);
  });
});
