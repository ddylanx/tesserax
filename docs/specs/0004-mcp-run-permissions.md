# Spec 0004: MCP permissions for workflow runs

Status: draft (2026-10-19)

## Goal

Decide in one place, the MCP page of tesserax, which MCP servers and tools an agent may use during a workflow run, and
have every engine (Claude Code, Antigravity, Gemini CLI) get exactly that when tesserax spawns it.

Today no engine can use MCP in a run:

| Engine | What happens today |
|---|---|
| Claude Code | Every spawn passes `--strict-mcp-config` with no `--mcp-config`, so the CLI loads no MCP server at all. `--allowedTools` never lists `mcp__*`, so a call would be refused in `-p` anyway. |
| Antigravity (`agy`) | Loads the user's global servers (`agy mcp list`), production database included. Every MCP call is auto-denied headless (`user denied permission for mcp(<server>/<tool>)`) and the step ends `SUCCESS` with an empty answer. |
| Gemini CLI | Loads user-level servers only in a trusted folder (worktrees are under a trusted folder). Calls in approval mode `plan` are expected to be refused headless; not verified (not logged in). |

Non-goals: adding or editing MCP server definitions from tesserax (they stay in each client's own config), storing
secrets, MCP for the classifier.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Where does the policy live? | In the tesserax database, owned by the `mcp` module. Server definitions are still read from the client configs (as the MCP page does today). |
| 2 | Default | Deny. A server is used in runs only after it is switched on. A server whose name or target contains `prod` needs a second confirmation in the UI. |
| 3 | Granularity | Per server: off / all tools / chosen tools. Tool names come from a one-off `tools/list` against the server, cached with the time it was read. |
| 4 | Per node (roadmap P4) | A node may list servers/tools; the effective set is the intersection with the policy. A node can only narrow, never widen. |
| 5 | Antigravity per-run grants | Not available: `agy` has no flag to pick servers or grant permissions per run. The undocumented `ANTIGRAVITY_PERM_GRANTS` variable was tried and has no effect on `--print` runs. So for agy the grants are written to `~/.gemini/antigravity-cli/settings.json` (see below). |

## Data model

`mcp_policy` (one row per server):

| Column | Type | Notes |
|---|---|---|
| `server` | text, PK | Server name as the clients know it |
| `mode` | text | `off` \| `all` \| `tools` |
| `tools` | json string[] | Used when `mode = tools` |
| `engines` | json string[] | Which engines may use it (`claude`, `antigravity`, `gemini`) |
| `updated_at` | timestamp | |

`mcp_tool_cache` (`server`, `tools` json, `read_at`).

## Module API

`McpService.grantFor({ engine, node? }): McpGrant` returns the effective set:
`{ servers: { name, definition, tools: string[] | '*' }[] }`. `definition` is the client config entry (command/url, env
names). Env values are read from the source config at spawn time and never stored or logged by tesserax.

HTTP: `GET /api/mcp/policy`, `PUT /api/mcp/policy/:server`, `POST /api/mcp/servers/:server/tools/refresh`.

## Applying the grant per engine

### Claude Code (fully per run)

- Write `runDir/mcp.json` (mode 600) with only the granted servers, copied from `~/.claude.json` / `.mcp.json`.
- Args: `--mcp-config <runDir>/mcp.json --strict-mcp-config`, and add `mcp__<server>__<tool>` (or `mcp__<server>__*`) to
  `--allowedTools`. Applies to `launcher.ts` (agent steps) and `executors/claude.ts` (read-only steps).
- Delete `mcp.json` when the run is finalized.

### Gemini CLI (per run)

- `--allowed-mcp-server-names <granted servers>`; tool-level allow via the policy engine (`--allowed-tools` is
  deprecated). To verify once Gemini is logged in.

### Antigravity (shared config)

- Tesserax keeps the `mcp(<server>/<tool>)` rules for the policy in `permissions.allow` of
  `~/.gemini/antigravity-cli/settings.json`. It records which rules it added (in `mcp_policy`), adds/removes only those,
  and never touches the user's own rules. The file is rewritten atomically.
- Consequences, shown on the MCP page: these rules also apply when the user runs `agy` by hand; agy still sees every
  global server (including prod) even when it may not call them; a per-node narrowing (decision 4) is a prompt hint
  only for agy, not enforced.
- `withToolHint` lists the MCP tools the step may call, so agy does not stop on a refused call.

## UI (MCP page)

Each server row gets: a switch (off / all / chosen tools), a tool picker, engine checkboxes, the `prod` confirmation,
and a note for Antigravity that the grant is global to agy.

## Tests

- `grantFor` intersection (policy × node), deny by default.
- Claude args contain `--mcp-config` and the right `mcp__` entries; `mcp.json` has only granted servers.
- agy settings writer: adds/removes only its own rules, keeps user rules and unknown keys.
