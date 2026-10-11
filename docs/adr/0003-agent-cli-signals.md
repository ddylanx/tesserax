# ADR 0003: Signals from the Claude Code CLI

Status: accepted (2026-10-11). Observed with `claude` 2.1.72 at `/opt/homebrew/bin/claude` on macOS; re-check after CLI upgrades.

## Context

The pipeline runs the local Claude Code CLI headless (`claude -p --output-format json`) to classify issues and to run playbooks. It uses the machine's own Claude Code login, so no API key is needed. We have to tell a finished run from a failed one, and say *why* it failed (login, quota, budget...) so the user knows what to do. The CLI has no dedicated error codes for these cases, so we read what it prints.

## What the CLI gives us

`--output-format json` prints one object on stdout when it is done:

```json
{ "type": "result", "subtype": "success", "is_error": false, "result": "<final text>", "session_id": "…",
  "total_cost_usd": 0.01, "duration_ms": 1200, "num_turns": 3, "usage": { … } }
```

Observed or documented cases:

| Case | What we see | Signal |
|---|---|---|
| Finished | exit 0, `is_error: false`, `subtype: "success"` | `ok` |
| Not logged in / login expired | exit 1, `is_error: true`, **`subtype: "success"`**, `result` starts with `Failed to authenticate. API Error: 401 … "OAuth access token is invalid."` (observed) | `auth` |
| Started from inside another Claude Code session (`CLAUDECODE` set) | exit 1, nothing on stdout, stderr `Error: Claude Code cannot be launched inside another Claude Code session.` (observed) | `nested_session` |
| Usage limit (Pro/Max plan) | `is_error: true`, `result` like `Claude AI usage limit reached…` / `…limit will reset at…` (not observed here; matched loosely) | `quota` |
| API overloaded | `overloaded_error` / `529` in result or stderr | `overloaded` |
| `--max-budget-usd` reached | `subtype: "error_max_budget_usd"` (documented subtype; matched also on "budget") | `budget` |
| Turn limit | `subtype: "error_max_turns"` | `max_turns` |
| Our timeout | we stop the process (SIGTERM, then SIGKILL after 2 s) | `timeout` |
| Binary missing | spawn `ENOENT` | `not_installed` |
| Anything else | `is_error: true` or non-zero exit; or no result object | `error` / `no_output` |

Note: `subtype` is `"success"` even for the 401 case, so `is_error` and the text decide, never `subtype` alone.

## Quirks found (2.1.72)

- `--json-schema` made the process hang (no output) when it could not authenticate. We do not use it; the classifier asks for JSON in the prompt and validates the reply with Zod (it still reads `structured_output` if a newer CLI returns it).
- With `--tools ""` the CLI printed its result and then **did not exit**. The runner therefore stops the process 3 s after a complete result object appears on stdout. Such a run counts as finished, not as a timeout.
- Variables inherited from a parent Claude Code session (`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK_*`, `ANTHROPIC_BASE_URL`, …) either block the start or send requests to the parent's endpoint. The runner removes them (`cleanEnv`). An `ANTHROPIC_API_KEY` the user set on purpose is kept.

## Decision

- `packages/modules/pipeline/src/agent/claude-cli.ts` holds `runClaude` (spawn, timeout, result parsing, lingering-process stop) and `detectSignal` (table above). Classification and playbook runs both use it.
- Classification: any signal other than `ok`, or a reply that fails Zod, falls back to the rules classifier; the reason is stored in the run's history (`fallbackReason`).
- Playbook runs: `auth`, `quota`, `budget`, `nested_session` and `not_installed` fail the run at once with the message (retrying would not help until the user acts); other failures follow the normal retry policy.
- `scripts/fake-claude.mjs` reproduces these cases (`FAKE_CLAUDE_MODE=auth|quota|hang|invalid|crash`) for tests.
