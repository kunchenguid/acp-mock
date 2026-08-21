import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(
  join(repoRoot, ".github", "workflows", "no-mistakes-required.yml"),
  "utf8",
);

const SIGNATURE =
  "Updates from [git push no-mistakes](https://github.com/kunchenguid/no-mistakes)";
const ATTESTATION_PREFIX = "<!-- no-mistakes-pipeline-attestation:v1";
const VERSION_FLOOR = "no-mistakes >= 1.46.0";
const ATTESTATION_PR = "https://github.com/kunchenguid/no-mistakes/pull/670";
const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

const COMPLETED_STEPS = [
  { step: "intent", status: "completed" },
  { step: "rebase", status: "completed" },
  { step: "review", status: "completed" },
  { step: "test", status: "completed" },
  { step: "document", status: "completed" },
  { step: "lint", status: "completed" },
  { step: "push", status: "completed" },
  { step: "pr", status: "running" },
  { step: "ci", status: "pending" },
];

function extractRunScript(yaml: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^\s+run:\s*\|/.test(line));
  if (start < 0) {
    throw new Error("workflow has no run script");
  }
  const body: string[] = [];
  let indent: number | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      if (indent !== null) body.push("");
      continue;
    }
    const leading = /^\s*/.exec(line)?.[0].length ?? 0;
    if (indent === null) indent = leading;
    if (leading < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

function attestationComment(
  steps: Array<{ step: string; status: string }>,
  headSha = HEAD_SHA,
): string {
  return `${ATTESTATION_PREFIX} ${JSON.stringify({ head_sha: headSha, steps })} -->`;
}

function pipelineBody(parts: {
  signature?: boolean;
  comment?: string;
  extra?: string;
}): string {
  const lines = ["## Pipeline", ""];
  if (parts.signature !== false) lines.push(SIGNATURE);
  if (parts.comment) lines.push(parts.comment);
  if (parts.extra) lines.push(parts.extra);
  return `${lines.join("\n")}\n`;
}

function runGate(prBody: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "nm-required-gate-"));
  const scriptPath = join(dir, "gate.sh");
  writeFileSync(scriptPath, extractRunScript(workflow));
  try {
    const result = spawnSync("bash", [scriptPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        PR_BODY: prBody,
        PR_AUTHOR: "alice",
        PR_NUMBER: "42",
      },
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("no-mistakes-required gate", () => {
  it("fails unsigned PRs without treating them as an old no-mistakes client", () => {
    const result = runGate("Please merge this change.");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "This PR was not raised through no-mistakes.",
    );
    expect(result.stderr).toContain("git push no-mistakes");
    expect(result.stderr).toContain("CONTRIBUTING.md");
    expect(result.stderr).not.toContain(VERSION_FLOOR);
  });

  it("fails signature-only bodies from older no-mistakes clients", () => {
    const result = runGate(pipelineBody({}));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(VERSION_FLOOR);
    expect(result.stderr).toContain(ATTESTATION_PR);
    expect(result.stderr).toContain("only writes the signature");
  });

  it("fails when the attestation comment is not parseable JSON", () => {
    const result = runGate(
      pipelineBody({
        comment: `${ATTESTATION_PREFIX} {not-json} -->`,
      }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(VERSION_FLOOR);
    expect(result.stderr).toContain(ATTESTATION_PR);
    expect(result.stderr).toMatch(/could not parse|not parseable|unparseable/i);
  });

  it("fails when attestation JSON is missing head_sha", () => {
    const result = runGate(
      pipelineBody({
        comment: `${ATTESTATION_PREFIX} ${JSON.stringify({ steps: COMPLETED_STEPS })} -->`,
      }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(VERSION_FLOOR);
  });

  it("accepts a signature plus completed review, test, and document steps", () => {
    const result = runGate(
      pipelineBody({ comment: attestationComment(COMPLETED_STEPS) }),
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    expect(result.stdout).toContain(
      "Found no-mistakes signature in PR #42 body.",
    );
    expect(result.stdout).toMatch(/attestation/);
  });

  it.each([
    ["review", "skipped"],
    ["test", "failed"],
    ["document", "pending"],
    ["review", "running"],
  ] as const)("fails when %s is %s", (step, status) => {
    const steps = COMPLETED_STEPS.map((item) =>
      item.step === step ? { ...item, status } : item,
    );
    const result = runGate(
      pipelineBody({ comment: attestationComment(steps) }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${step} status=${status}`);
    expect(result.stderr).toContain(
      "Quota skips and agent skips are not compliant",
    );
    expect(result.stderr).not.toContain(VERSION_FLOOR);
  });

  it("fails when a required step is missing from the attestation", () => {
    const steps = COMPLETED_STEPS.filter((item) => item.step !== "document");
    const result = runGate(
      pipelineBody({ comment: attestationComment(steps) }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("document status=missing");
  });
});
