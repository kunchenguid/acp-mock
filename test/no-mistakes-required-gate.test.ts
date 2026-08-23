import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(
  repoRoot,
  ".github",
  "workflows",
  "no-mistakes-required.yml",
);

interface WorkflowModel {
  on: { pull_request: unknown };
  permissions: unknown;
  concurrency: unknown;
  jobs: {
    check: {
      name: unknown;
      "runs-on": unknown;
      if: unknown;
      steps: unknown;
    };
  };
}

function loadWorkflow(): WorkflowModel {
  const ruby = String.raw`
    require "json"
    require "psych"
    workflow = Psych.safe_load(File.read(ARGV.fetch(0)), aliases: true)
    # Psych implements YAML 1.1, where the unquoted GitHub Actions key "on" is
    # parsed as boolean true. Normalize it to the Actions data model.
    workflow["on"] = workflow.delete(true) if workflow.key?(true)
    puts JSON.generate(workflow)
  `;
  const result = spawnSync("ruby", ["-e", ruby, workflowPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "failed to parse workflow YAML");
  }
  return JSON.parse(result.stdout) as WorkflowModel;
}

describe("no-mistakes-required workflow", () => {
  it("calls the pinned shared gate with the repository's existing policy boundary", () => {
    const workflow = loadWorkflow();
    const pullRequest = workflow.on.pull_request;
    const job = workflow.jobs.check;

    expect(pullRequest).toEqual({
      types: ["opened", "edited", "reopened"],
      branches: ["main"],
      "paths-ignore": [
        ".release-please-manifest.json",
        "CHANGELOG.md",
        "package.json",
      ],
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({
      group:
        "no-mistakes-required-${{ github.event.pull_request.number }}-${{ (github.event.action == 'opened' || github.event.action == 'edited') && github.run_id || 'head-change' }}",
      "cancel-in-progress": true,
    });

    expect(job.name).toBe("PR must be raised via no-mistakes");
    expect(job["runs-on"]).toBe("ubuntu-latest");
    expect(job.if).toBe(
      "github.event.pull_request.user.login != 'github-actions[bot]' && github.event.pull_request.user.login != 'dependabot[bot]' && github.event.pull_request.user.login != 'release-please[bot]'",
    );
    expect(job.steps).toEqual([
      {
        name: "Verify no-mistakes signature and pipeline attestation in PR body",
        uses: "kunchenguid/no-mistakes/.github/actions/require-no-mistakes@32d396ac0f29135daf7fcb9964aba9d5f4e796d6",
      },
    ]);
  });
});
