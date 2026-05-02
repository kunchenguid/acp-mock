import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Agent,
  AgentSideConnection,
  AuthenticateResponse,
  CancelNotification,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  SessionNotification,
  SessionId,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { AppendFileOptions, UsageUpdateMode } from "./index.js";

export interface AcpMockAgentOptions {
  eventLogPath?: string;
  runtimeEventsPath?: string;
  agentMessage: string;
  usageUpdateUsed?: number;
  usageUpdateSize: number;
  usageUpdateMode: UsageUpdateMode;
  toolCallCount: number;
  promptDelayMs?: number;
  appendFile?: AppendFileOptions;
}

interface SessionState {
  cwd: string;
  pendingPrompt: AbortController | null;
  promptCount: number;
}

interface RuntimeTraceEvent {
  type?: unknown;
  stream?: unknown;
  text?: unknown;
  tag?: unknown;
  used?: unknown;
  size?: unknown;
  toolCallId?: unknown;
  status?: unknown;
  title?: unknown;
}

type SessionUpdate = SessionNotification["update"];
type ToolCallStatus = Extract<
  SessionUpdate,
  { sessionUpdate: "tool_call" }
>["status"];

function normalizeToolCallStatus(value: unknown): ToolCallStatus | undefined {
  if (
    value === "pending" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  return undefined;
}

function randomSessionId(): string {
  return Array.from(randomBytes(16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("cancelled"));
      },
      { once: true },
    );
  });
}

export class AcpMockAgent implements Agent {
  private readonly sessions = new Map<SessionId, SessionState>();

  constructor(
    private readonly connection: AgentSideConnection,
    private readonly options: AcpMockAgentOptions,
  ) {}

  appendLog(event: string, details: Record<string, unknown> = {}): void {
    if (!this.options.eventLogPath) return;
    appendFileSync(
      this.options.eventLogPath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), pid: process.pid, event, ...details })}\n`,
      "utf-8",
    );
  }

  async initialize(): Promise<InitializeResponse> {
    this.appendLog("agent:initialize");
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
      },
    };
  }

  async authenticate(): Promise<AuthenticateResponse> {
    return {};
  }

  async setSessionMode(): Promise<SetSessionModeResponse> {
    return {};
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const sessionId = randomSessionId();
    this.sessions.set(sessionId, {
      cwd: params.cwd,
      pendingPrompt: null,
      promptCount: 0,
    });
    this.appendLog("agent:newSession", { sessionId, cwd: params.cwd });
    return { sessionId };
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.appendLog("agent:cancel", { sessionId: params.sessionId });
    this.sessions.get(params.sessionId)?.pendingPrompt?.abort();
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) throw new Error(`Unknown session: ${params.sessionId}`);

    session.pendingPrompt?.abort();
    const controller = new AbortController();
    session.pendingPrompt = controller;
    session.promptCount += 1;
    this.appendLog("agent:prompt:start", { sessionId: params.sessionId });

    try {
      if (this.options.promptDelayMs && this.options.promptDelayMs > 0) {
        await sleepWithAbort(this.options.promptDelayMs, controller.signal);
      }

      if (this.options.runtimeEventsPath) {
        await this.replayTraceFile(params.sessionId, session.cwd);
        this.applyAppendFile(session.cwd);
      } else {
        await this.emitUsage(params.sessionId, session.promptCount);
        await this.emitToolCalls(params.sessionId);
        this.applyAppendFile(session.cwd);
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: this.options.agentMessage,
            },
          },
        });
      }

      this.appendLog("agent:prompt:done");
      return { stopReason: "end_turn" };
    } catch (error) {
      if (controller.signal.aborted) {
        this.appendLog("agent:prompt:cancelled");
        return { stopReason: "cancelled" };
      }
      throw error;
    } finally {
      if (session.pendingPrompt === controller) session.pendingPrompt = null;
    }
  }

  private async emitUsage(
    sessionId: string,
    promptCount: number,
  ): Promise<void> {
    if (this.options.usageUpdateUsed === undefined) return;
    const used =
      this.options.usageUpdateMode === "cumulative"
        ? this.options.usageUpdateUsed * promptCount
        : this.options.usageUpdateUsed;
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "usage_update",
        used,
        size: this.options.usageUpdateSize,
      },
    });
    this.appendLog("agent:prompt:usage", {
      used,
    });
  }

  private async replayTraceFile(sessionId: string, cwd: string): Promise<void> {
    const contents = readFileSync(this.options.runtimeEventsPath!, "utf-8");
    const events = contents
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RuntimeTraceEvent);

    let emitted = 0;
    for (const event of events) {
      const update = this.traceEventToSessionUpdate(event, cwd);
      if (!update) continue;
      await this.connection.sessionUpdate({ sessionId, update });
      emitted += 1;
    }
    this.appendLog("agent:trace:replayed", { emitted });
  }

  private traceEventToSessionUpdate(
    event: RuntimeTraceEvent,
    cwd: string,
  ): SessionUpdate | null {
    if (event.type === "text_delta") {
      const stream = event.stream === "thought" ? "thought" : "output";
      return {
        sessionUpdate:
          stream === "thought" ? "agent_thought_chunk" : "agent_message_chunk",
        content: {
          type: "text",
          text: String(event.text ?? "").replaceAll("<cwd>", cwd),
        },
      };
    }

    if (event.type === "status" && event.tag === "usage_update") {
      if (typeof event.used !== "number" || typeof event.size !== "number") {
        return null;
      }
      return {
        sessionUpdate: "usage_update",
        used: event.used,
        size: event.size,
      };
    }

    if (event.type === "tool_call") {
      const toolCallId = String(event.toolCallId ?? `mock-tool-${Date.now()}`);
      const status = normalizeToolCallStatus(event.status);
      const title =
        event.title !== undefined
          ? String(event.title).replaceAll("<cwd>", cwd)
          : undefined;
      if (event.tag === "tool_call_update") {
        return {
          sessionUpdate: "tool_call_update",
          toolCallId,
          ...(title !== undefined ? { title } : {}),
          ...(status !== undefined ? { status } : {}),
        };
      }
      return {
        sessionUpdate: "tool_call",
        toolCallId,
        kind: "other",
        title: title ?? "mock tool",
        ...(status !== undefined ? { status } : {}),
      };
    }

    return null;
  }

  private async emitToolCalls(sessionId: string): Promise<void> {
    for (let i = 0; i < this.options.toolCallCount; i++) {
      const toolCallId = `mock-tool-${i}`;
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          kind: "other",
          title: "mock tool",
          status: "pending",
        },
      });
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
        },
      });
    }
    if (this.options.toolCallCount > 0) {
      this.appendLog("agent:prompt:tool-calls", {
        count: this.options.toolCallCount,
      });
    }
  }

  private applyAppendFile(cwd: string): void {
    const append = this.options.appendFile;
    if (!append) return;
    appendFileSync(join(cwd, append.path), append.text, "utf-8");
    this.appendLog("workspace:changed", { path: append.path });
  }
}
