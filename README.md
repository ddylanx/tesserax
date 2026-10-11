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
- **System**: health of Postgres and pg-boss, workspaces, schedules, which integrations are configured.

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
