# PR body compliance event replay

This replay exercised the real `Verify no-mistakes signature in PR body` shell
step extracted from `.github/workflows/no-mistakes-required.yml`. It models the
incident-shaped sequence on one PR and unchanged head SHA: a signed `opened`
event, an unsigned `edited` event, and a signed `edited` event.

## Event results

| Run ID | Run number | Action | Concurrency group | Conclusion |
| ---: | ---: | --- | --- | --- |
| `29962844999` | 586 | opened | `no-mistakes-required-549-29962844999` | success |
| `29962943078` | 587 | edited | `no-mistakes-required-549-29962943078` | failure |
| `29965243268` | 588 | edited | `no-mistakes-required-549-29965243268` | success |

All three body-bearing events have immutable, distinct concurrency groups, so
none can replace or cancel another same-PR body event.

The preserved head-change groups were:

```text
synchronize -> no-mistakes-required-549-head-change
reopened    -> no-mistakes-required-549-head-change
```

## Reviewer-visible run titles

```text
PR #549 body compliance - opened - event 586 (run 29962844999)
PR #549 body compliance - edited - event 587 (run 29962943078)
PR #549 body compliance - edited - event 588 (run 29965243268)
```

## Actual compliance-step output

### Signed opened event

```text
Found no-mistakes signature in PR #549 body.
```

Exit status: `0` (`success`)

### Unsigned edited event

```text
::error::This PR was not raised through no-mistakes.

Contributions to this repository must be submitted via 'git push no-mistakes'.
That pipeline runs the required review/test/lint/CI steps and writes a
deterministic '## Pipeline' section into the PR body containing:

    Updates from [git push no-mistakes](https://github.com/kunchenguid/no-mistakes)

See CONTRIBUTING.md for setup and the full workflow.

PR author: first-time-fork-contributor
```

Exit status: `1` (`failure`)

### Signed edited event

```text
Found no-mistakes signature in PR #549 body.
```

Exit status: `0` (`success`)

## Preserved policy boundaries

The focused contract check also verified:

- the trigger remains `pull_request` for `opened`, `edited`, `synchronize`, and
  `reopened` events targeting `main`
- permissions remain `contents: read`
- no secret reference, checkout, or fork-code execution was introduced
- `cancel-in-progress: true` remains enabled
- the stable check name remains `PR must be raised via no-mistakes`
- the signature marker and all three bot exemptions remain unchanged
- the workflow's two changed expressions exactly match the canonical changes
  from `kunchenguid/no-mistakes` PR #558

No screenshot was captured because this change has no rendered application UI.
The GitHub workflow's user-facing surfaces are its run title, terminal
conclusion, and compliance-step output, all recorded above.
