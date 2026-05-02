import { describe, expect, it } from "vitest";
import {
  mockAgentArgs,
  mockAgentCommand,
  readJsonLines,
} from "../src/index.js";

describe("test helpers", () => {
  it("serializes mock options into stable CLI args", () => {
    expect(
      mockAgentArgs({
        eventLogPath: "/tmp/acp mock.jsonl",
        runtimeEventsPath: "/tmp/trace.jsonl",
        agentMessageJson: { success: true, summary: "done" },
        usageUpdateUsed: 120,
        toolCallCount: 2,
        appendFile: { path: "README.md", text: "- changed\n" },
      }),
    ).toEqual([
      "--event-log",
      "/tmp/acp mock.jsonl",
      "--replay-runtime-events",
      "/tmp/trace.jsonl",
      "--agent-message-json",
      '{"success":true,"summary":"done"}',
      "--usage-update-used",
      "120",
      "--tool-call-count",
      "2",
      "--append-file",
      "README.md",
      "--append-text",
      "- changed\n",
    ]);
  });

  it("builds a shell-safe command for acpx registry overrides", () => {
    expect(
      mockAgentCommand({
        bin: "/tmp/acp mock/bin.js",
        eventLogPath: "/tmp/mock log.jsonl",
        agentMessage: "hello world",
      }),
    ).toBe(
      'node "/tmp/acp mock/bin.js" --event-log "/tmp/mock log.jsonl" --agent-message "hello world"',
    );
  });

  it("reads newline-delimited JSON logs", () => {
    expect(
      readJsonLines('{"event":"one"}\n\n{"event":"two","value":2}\n'),
    ).toEqual([{ event: "one" }, { event: "two", value: 2 }]);
  });
});
