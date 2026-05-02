export interface AppendFileOptions {
  path: string;
  text: string;
}

export interface MockAgentCommandOptions {
  bin?: string;
  eventLogPath?: string;
  runtimeEventsPath?: string;
  agentMessageJson?: unknown;
  agentMessage?: string;
  usageUpdateUsed?: number;
  usageUpdateSize?: number;
  toolCallCount?: number;
  promptDelayMs?: number;
  appendFile?: AppendFileOptions;
}

function pushNumberArg(
  args: string[],
  flag: string,
  value: number | undefined,
) {
  if (value !== undefined) args.push(flag, String(value));
}

export function mockAgentArgs(options: MockAgentCommandOptions = {}): string[] {
  const args: string[] = [];
  if (options.eventLogPath) args.push("--event-log", options.eventLogPath);
  if (options.runtimeEventsPath) {
    args.push("--replay-runtime-events", options.runtimeEventsPath);
  }
  if (options.agentMessageJson !== undefined) {
    args.push("--agent-message-json", JSON.stringify(options.agentMessageJson));
  }
  if (options.agentMessage !== undefined) {
    args.push("--agent-message", options.agentMessage);
  }
  pushNumberArg(args, "--usage-update-used", options.usageUpdateUsed);
  pushNumberArg(args, "--usage-update-size", options.usageUpdateSize);
  pushNumberArg(args, "--tool-call-count", options.toolCallCount);
  pushNumberArg(args, "--prompt-delay-ms", options.promptDelayMs);
  if (options.appendFile) {
    args.push("--append-file", options.appendFile.path);
    args.push("--append-text", options.appendFile.text);
  }
  return args;
}

function shellQuote(token: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(token)) return token;
  return JSON.stringify(token);
}

export function mockAgentCommand(
  options: MockAgentCommandOptions = {},
): string {
  const bin = options.bin ?? "acp-mock";
  const command =
    bin.endsWith(".js") || bin.endsWith(".mjs") ? ["node", bin] : [bin];
  return [...command, ...mockAgentArgs(options)].map(shellQuote).join(" ");
}

export function readJsonLines(contents: string): Record<string, unknown>[] {
  return contents
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
