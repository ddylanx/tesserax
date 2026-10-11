# Open Tesseract (local)

A personal backoffice for managing AI coding work, running on your own machine: tasks, agents (Claude Code sessions), MCP servers and system health on one page.

Local mode: one backend process, bound to 127.0.0.1, no login.

## Requirements

- Node 22+ and pnpm 10 (`corepack enable`)
- Docker Desktop running (for Postgres 16)

## Run

```bash
cd open-tesseract
cp .env.example .env        # first time only; defaults work as-is
pnpm install
pnpm dev                    # starts Postgres (Docker), the API and the web app
```

- Web: http://127.0.0.1:5180
- API: http://127.0.0.1:4400 (health: http://127.0.0.1:4400/health)

The API migrates and seeds the database (workspaces *Personal* and *Company*) every time it starts.

Stop with Ctrl+C. `pnpm db:down` stops Postgres (data is kept in a Docker volume).

## Pages

- **MCP**: every MCP server configured on this machine (Claude Code user/local/project scopes, Cursor, Claude Desktop, Codex, Gemini, Antigravity), on/off, read-only. It reuses the reader in `../agent-cockpit/src/mcp.mjs` (`AGENT_COCKPIT_MCP_PATH` to point elsewhere); without it, a built-in Claude Code-only reader is used. Only names, transport and env key names are read, never values.
- **Agents**: Claude Code sessions on this machine: running / needs you / idle / ended, folder, git branch, last activity, prompt and tool counts, token usage. Click a row for its recent events. Fed by Claude Code hooks (below).
- **System**: health of Postgres and pg-boss, workspaces, schedules, which integrations are configured.

## Connect Claude Code (Agents page)

Claude Code reports each session to `POST http://127.0.0.1:4400/api/agents/events` through hooks: every hook pipes its JSON to `curl`. The command fails silently (2 s timeout, `|| true`), so Claude Code is never blocked when the backoffice is off.

```bash
pnpm hooks:print                                                   # show the snippet, changes nothing
pnpm hooks:install --file ~/some-project/.claude/settings.local.json   # one project
pnpm hooks:install --user                                          # all projects (~/.claude/settings.json)
pnpm hooks:uninstall --user                                        # remove again
```

`install` keeps your existing hooks, adds ours once (it is safe to run again) and writes a timestamped backup of the file first. Restart running Claude Code sessions to pick it up.

The hook for each of these events is the same command: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` (matcher `*`), `Notification`, `Stop`, `SubagentStop`, `PreCompact`, `SessionEnd`:

```json
{ "type": "command", "command": "curl -s -m 2 -o /dev/null -X POST -H 'content-type: application/json' --data-binary @- http://127.0.0.1:4400/api/agents/events || true" }
```

What is stored: session id, folder, branch (read from `.git/HEAD`), model, status, last tool, the first 300 characters of your last prompt, notification text, and per event a short target (file path or command, 160 characters). Hooks carry no token counts, so usage is read from the session's transcript file (`transcript_path`, numbers and model name only). Tool output and file contents are never stored. Events older than 14 days are pruned; sessions silent for 12 hours are marked ended.

## Ports

| What | Port |
|---|---|
| Web (Vite) | 5180 |
| API (NestJS) | 4400 |
| Postgres | 54329 (set `OT_PG_PORT` and `DATABASE_URL` to change) |

## Other commands

```bash
pnpm typecheck     # tsc in every package
pnpm db:migrate    # run migrations without starting the API
pnpm db:seed
```

See [CLAUDE.md](CLAUDE.md) for the code layout.
