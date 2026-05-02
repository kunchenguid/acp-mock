import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "src", "cli.ts");

function runCli(args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", cliPath, ...args],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

describe("cli", () => {
  it("prints clean help output", async () => {
    const result = await runCli(["--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: acp-mock");
    expect(result.stdout).toContain("--agent-message-json");
    expect(result.stdout).toContain("--usage-update-used");
    expect(result.stdout).toContain("--prompt-delay-ms");
    expect(result.stdout).not.toContain("acp-mock: (outputHelp)");
    expect(result.stderr).toBe("");
  });
});
