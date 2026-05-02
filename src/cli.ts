#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import { Command } from "commander";
import { AcpMockAgent, type AcpMockAgentOptions } from "./mock-agent.js";

interface CliOptions {
  eventLog?: string;
  replayRuntimeEvents?: string;
  agentMessageJson?: string;
  agentMessage?: string;
  usageUpdateUsed?: string;
  usageUpdateSize?: string;
  toolCallCount?: string;
  promptDelayMs?: string;
  appendFile?: string;
  appendText?: string;
}

function parseOptionalNumber(
  name: string,
  value: string | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return parsed;
}

function parseOptions(raw: CliOptions): AcpMockAgentOptions {
  let agentMessage = raw.agentMessage ?? "mock acp response";
  if (raw.agentMessageJson !== undefined) {
    agentMessage = JSON.stringify(JSON.parse(raw.agentMessageJson));
  }

  const appendFile = raw.appendFile
    ? {
        path: raw.appendFile,
        text: raw.appendText ?? "- changed by acp-mock\n",
      }
    : undefined;

  return {
    eventLogPath: raw.eventLog,
    runtimeEventsPath: raw.replayRuntimeEvents,
    agentMessage,
    usageUpdateUsed: parseOptionalNumber(
      "--usage-update-used",
      raw.usageUpdateUsed,
    ),
    usageUpdateSize:
      parseOptionalNumber("--usage-update-size", raw.usageUpdateSize) ?? 200000,
    toolCallCount:
      parseOptionalNumber("--tool-call-count", raw.toolCallCount) ?? 0,
    promptDelayMs: parseOptionalNumber("--prompt-delay-ms", raw.promptDelayMs),
    appendFile,
  };
}

function createProgram(): Command {
  return new Command()
    .name("acp-mock")
    .description("Run a deterministic ACP mock agent over stdio")
    .option("--event-log <path>", "write lifecycle JSONL logs")
    .option(
      "--replay-runtime-events <path>",
      "replay normalized acpx runtime events from a JSONL trace",
    )
    .option(
      "--agent-message-json <json>",
      "emit this JSON object as the final assistant message",
    )
    .option(
      "--agent-message <text>",
      "emit this text as the final assistant message",
    )
    .option(
      "--usage-update-used <tokens>",
      "emit a usage_update with this used count",
    )
    .option(
      "--usage-update-size <tokens>",
      "usage_update context size",
      "200000",
    )
    .option(
      "--tool-call-count <count>",
      "emit this many tool_call/tool_call_update pairs",
      "0",
    )
    .option(
      "--prompt-delay-ms <ms>",
      "delay the turn until cancelled or the timeout elapses",
    )
    .option(
      "--append-file <path>",
      "append text to a file relative to the session cwd",
    )
    .option("--append-text <text>", "text to append when --append-file is set")
    .showHelpAfterError();
}

function appendProcessReadyLog(options: AcpMockAgentOptions): void {
  if (!options.eventLogPath) return;
  appendFileSync(
    options.eventLogPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), pid: process.pid, event: "process:ready" })}\n`,
    "utf-8",
  );
}

export function main(argv = process.argv): void {
  const program = createProgram();
  let options: AcpMockAgentOptions;
  try {
    program.parse(argv);
    options = parseOptions(program.opts<CliOptions>());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`acp-mock: ${message}\n`);
    process.exitCode = 2;
    return;
  }

  const output = Writable.toWeb(process.stdout);
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(output, input);
  const connection = new AgentSideConnection(
    (conn) => new AcpMockAgent(conn, options),
    stream,
  );
  void connection;
  appendProcessReadyLog(options);
}

main();
