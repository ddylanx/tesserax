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

- **Inbox**: the automation pipeline (below): issues waiting for your decision, running playbooks, results waiting for you to verify.

- **MCP**: every MCP server configured on this machine (Claude Code user/local/project scopes, Cursor, Claude Desktop, Codex, Gemini, Antigravity), on/off, read-only. It reuses the reader in `../agent-cockpit/src/mcp.mjs` (`AGENT_COCKPIT_MCP_PATH` to point elsewhere); without it, a built-in Claude Code-only reader is used. Only names, transport and env key names are read, never values.
- **Tasks**: your Jira Cloud issues, read-only, synced every ~2 minutes (pg-boss schedule with up to 30 s jitter) and on start; "Sync now" queues one right away. Filters: text, workspace, status, project, archived. Issues the query stops returning are archived, not deleted.
- **Agents**: Claude Code sessions on this machine: running / needs you / idle / ended, folder, git branch, last activity, prompt and tool counts, token usage. Click a row for its recent events. Fed by Claude Code hooks (below).
- **System**: health of Postgres and pg-boss, workspaces, schedules, which integrations are configured.

## Workflows (Runs)

Each ticket runs through a **workflow**: a graph of nodes stored in `workflows/<id>.workflow.json` (see [spec 0001](docs/specs/0001-workflow-engine.md)). The default one:

```
Jira ticket → Analyze (AI) → you review → Options + spec (AI) → you approve → Implement (agent, worktree ot/<KEY>)
  → Tests + lint (fail → implement, max 2) → AI review vs spec (fail → implement, max 2) → you review the result → Score
```

- **Start**: "Start workflow" on the Tasks page, or automatically for new Jira issues (`AUTO_START=workflow`, the default; `pipeline` keeps the older Inbox flow, `off` disables).
- **Runs page** (`/runs`): runs waiting for you, running, failed, done. A run's page shows the graph with each node's state; click a node for its documents (every version, AI or yours), its attempts, cost and errors.
- **Gates**: edit the document (your version is what later steps use), approve, send it back with feedback (the AI step re-runs with your feedback), or reject.
- **Score**: rate the result per criterion (1–5) with a note; stored with the run's workflow and skill versions for later comparison.
- **Nodes**: `ai.step` (read-only `claude -p` with a skill → a document), `agent.run` (Claude Code in the worktree, commits locally, never pushes), `check.command` (shell commands in the worktree, e.g. `composer test`, `vendor/bin/pint --test`), `ai.review` (the agent reviews the diff against the spec and ends with `VERDICT: PASS/FAIL`), `human.gate`, `evaluate`.
- **Skills**: `skills/<name>/SKILL.md` (Claude Code skill format): analyze-requirements, write-spec, implement-from-spec, code-review, project-conventions. Edit them to tune each stage; each node run records the skill's hash.
- Loops have limits (`maxLoops`) and a fallback (`onLimit`), so a failing test does not loop forever.

- **Workflow editor** (`/workflows`): a canvas like n8n/Dify. Add nodes from the palette, drag from a port (the dots on the right of a node) to another node to connect, click a node to edit its settings (a form generated from the node type: skill, prompt, inputs/output, tools, model, budget, commands...), click an edge to set a loop limit and where to go when it is reached. Problems (unreachable node, port connected twice, missing prompt...) are shown live and block saving. Saving writes `workflows/<id>.workflow.json`; runs already in progress keep the version they started with. "New workflow" copies the default.
- **Skills page** (`/skills`): edit `SKILL.md` files, create new ones, and **try a skill on a ticket** (read-only, in the project's repo) to tune it before a workflow uses it.

Coming next: ticket docs, Jira comment and Bitbucket PR nodes (P2).

## Automation pipeline (Inbox, older flow)

```
Jira issue ─▶ AI classifies ─▶ YOU decide ─▶ AI runs a playbook ─▶ result ─▶ YOU verify (true / false)
              claude -p           accept / change    git worktree +          summary, diff,   stored as labeled
              (rules fallback)    / reject           claude -p headless      branch           feedback
```

1. **New issue**: a Jira issue seen for the first time (not the first import), or "Run pipeline" on the Tasks page, creates a run. One active run per issue.
2. **Classify**: the local `claude -p` (your Claude Code login, no API key) returns type (bug/feature/chore/research/question), automation (auto/assisted/manual), playbook, confidence and reasoning, validated with Zod. Issue text is passed as delimited, untrusted data. If the CLI is missing, not logged in or answers badly, a rules classifier (issue type, labels, title) is used and the reason is shown in the run's history.
3. **Decide** (you): accept or change type, automation and playbook, add a note for the agent, classify again, or reject. The issue's Jira project must map to a local repo in `config/repos.json` (copy `config/repos.example.json`): a path, or `{ "path": …, "base": "develop" }` to choose the branch new issue branches start from (default: the remote's default branch, `origin/HEAD`, never the branch your main checkout happens to be on). If a project is not mapped, the Inbox asks for the path and saves it.
4. **Run**: a git worktree on branch `ot/<ISSUE-KEY>` is created under `.data/worktrees/`, and Claude Code runs the playbook there headless (`claude -p`, prompt from a file, permission mode and allowed tools from the playbook, a budget cap). Push, merge, rebase, remote changes, `gh`, `curl` and `rm -rf` are always denied. Nothing is pushed or merged. The run survives an API restart; Cancel stops it.
5. **Verify** (you): the Inbox shows the agent's summary, diff stats and full diff, branch and worktree path. Mark it correct (true) or not (false) with a note; this is stored with the classification and playbook as labeled feedback (System page shows the totals). Optionally **Post result to Jira** as a comment, after you confirm the exact text in a dialog. That is the only thing ever written to Jira.

Playbooks are Markdown files in `playbooks/` (frontmatter: `id`, `name`, `applies_to`, `steps`, `permission_mode`, `allowed_tools`, `makes_changes`, `max_budget_usd`; body: the prompt template with `{{issue}}`, `{{steps}}`, `{{branch}}`, `{{worktree_path}}`, `{{user_note}}`). Shipped: `investigate-bug` (read-only), `fix-bug` (edits, runs tests, commits locally), `research-question` (read-only).

Every step is a pg-boss job keyed by (run, step, attempt): retried 3 times with backoff, then the run goes to **failed** with the error, and **Retry** starts the step again. Every state change is recorded in the run's history.

What the CLI's output means (logged out, usage limit, budget, timeouts...) is in [docs/adr/0003-agent-cli-signals.md](docs/adr/0003-agent-cli-signals.md). The CLI must be logged in: run `claude` in a terminal and use `/login` if classification falls back to rules with "auth".

Settings (`.env`): `CLAUDE_BIN` (default `claude`), `CLASSIFIER_ENGINE` (`claude-cli` or `rules`), `CLASSIFIER_MODEL`, `PLAYBOOK_MODEL`, `PLAYBOOK_TIMEOUT_SECONDS` (default 1800), `WEB_BASE_URL` (links in Telegram messages).

### Try it without Jira or tokens

```bash
pnpm fake-jira                    # terminal 1: fake Jira with 3 fixture issues (DEMO-1, DEMO-2, OPS-7)
scripts/make-demo-repo.sh         # a throwaway git repo at .data/demo-repo for project DEMO
CLAUDE_BIN=$PWD/scripts/fake-claude.mjs scripts/dev-fake.sh   # terminal 2: API against the fake Jira and a fake CLI
pnpm --filter @ot/web dev         # terminal 3: web
```
Then on Tasks, "Run pipeline" on DEMO-1, and enter `<repo>/.data/demo-repo` as its repo in the Inbox. Drop `CLAUDE_BIN=…` to use the real `claude`.

## Connect Jira Cloud (Tasks page)

1. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens
2. In `.env`:
   ```
   JIRA_BASE_URL=https://your-site.atlassian.net
   JIRA_EMAIL=you@company.com
   JIRA_API_TOKEN=...
   # optional
   JIRA_JQL=project = PAY AND statusCategory != Done ORDER BY updated DESC
   JIRA_WORKSPACE=company
   ```
3. Restart `pnpm dev`. The System page shows "Jira Cloud: configured" and the `tasks.jira-sync` schedule turns on.

Default JQL: issues assigned to you that are not done, plus those updated in the last 14 days. Reads with `GET /rest/api/3/search/jql`; for new or changed issues it also reads comments (last 20, text) and attachment metadata (never the files). Both plain API tokens and "API tokens with scopes" work (the latter through Atlassian's api.atlassian.com gateway). The only write is a comment, and only after you confirm it in the Inbox.

### Testing without a Jira account

```bash
pnpm fake-jira    # fake Jira on http://127.0.0.1:4499 serving fixtures/jira/issues.json
```
and in `.env`: `JIRA_BASE_URL=http://127.0.0.1:4499`, `JIRA_EMAIL=dev@example.com`, `JIRA_API_TOKEN=fake`.

## Telegram bot (read-only)

Long polling with grammY, so no public URL or webhook is needed; the bot runs inside the API process.

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. In `.env`: `TELEGRAM_BOT_TOKEN=...` and `TELEGRAM_ALLOWED_USER_IDS=<your numeric id>` (comma-separated for several).
   Don't know your id? Start the bot with the list empty and send it a message: it replies with your id.
3. Restart `pnpm dev`.

Commands: `/tasks` (open Jira tasks), `/agents` (Claude Code sessions, who needs you), `/mcp` (enabled MCP servers), `/help`. Anyone not on the list gets no data.

The bot also sends pipeline notifications to everyone on the list: classification ready (needs your decision), result ready (needs verify), and failures, each with a link to the run in the Inbox. Decisions and verification happen in the web app only.

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
