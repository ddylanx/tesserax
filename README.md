# Tesserax (local)

A personal backoffice for managing AI coding work, running on your own machine: tasks, agents (Claude Code sessions), MCP servers and system health on one page.

Local mode: one backend process, bound to 127.0.0.1, no login.

## Requirements

- Node 22+ and pnpm 10 (`corepack enable`)
- Docker Desktop running (for Postgres 16)

## Run

```bash
cd tesserax
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
- **Tasks**: your Jira Cloud issues, read-only, synced every ~2 minutes (pg-boss schedule with up to 30 s jitter) and on start; "Sync now" queues one right away. Filters: text, workspace, status, project, archived. Issues the query stops returning are archived, not deleted.
- **Agents**: Claude Code sessions on this machine: running / needs you / idle / ended, folder, git branch, last activity, prompt and tool counts, token usage. Click a row for its recent events. Fed by Claude Code hooks (below).
- **System**: health of Postgres and pg-boss, workspaces, schedules, which integrations are configured.

## Workflows (Runs)

Each ticket runs through a **workflow**: a graph of nodes stored in `workflows/<id>.workflow.json` (see [spec 0001](docs/specs/0001-workflow-engine.md)). The default one:

```
Jira ticket → Analyze (AI) → you review → Options + spec (AI) → you approve → Implement (agent, worktree tx/<KEY>)
  → Tests + lint (fail → implement, max 2) → AI review vs spec (fail → implement, max 2) → you review the result → Score
```

- **Start**: "Start workflow" on the Tasks page, or automatically for new Jira issues (`AUTO_START=workflow`, the default; `off` disables).
- **Runs page** (`/runs`): runs waiting for you, running, failed, done. A run's page shows the graph with each node's state; click a node for its documents (every version, AI or yours), its attempts, cost and errors.
- **Gates**: edit the document (your version is what later steps use), approve, send it back with feedback (the AI step re-runs with your feedback), or reject.
- **Score**: rate the result per criterion (1–5) with a note; stored with the run's workflow and skill versions for later comparison.
- **Nodes**: `ai.step` (read-only `claude -p` with a skill → a document), `agent.run` (Claude Code in the worktree, commits locally, never pushes), `check.command` (shell commands in the worktree, e.g. `composer test`, `vendor/bin/pint --test`), `ai.review` (the agent reviews the diff against the spec and ends with `VERDICT: PASS/FAIL`), `human.gate`, `evaluate`.
- **Skills**: your workflows and skills live in `workflows/` and `skills/` (gitignored; created from `examples/` on first `pnpm dev`). Format `skills/<name>/SKILL.md`: analyze-requirements, write-spec, implement-from-spec, code-review, project-conventions, jira-comment, pr-description, pr-review, ticket-doc. Edit them to tune each stage; each node run records the skill's hash.
- Loops have limits (`maxLoops`) and a fallback (`onLimit`), so a failing test does not loop forever.

- **Workflow editor** (`/workflows`): an n8n/Dify-style canvas built on React Flow. Searchable node palette grouped by kind (drag onto the canvas or click); node cards with icon, skill and coloured ports; **"+" on a connection** inserts a node in between; **dragging a port to empty space** (or right-clicking the canvas) opens a node menu at that spot; a settings drawer on the right (form generated from the node type: skill, prompt with placeholder hints, inputs/output, tools, model, budget, commands, skip rules); click a connection to set a loop limit and where to go when it is reached; **Tidy up** arranges the graph automatically (ELK layered layout, long chains wrap into rows); undo/redo (Cmd+Z / Shift+Cmd+Z), copy/paste (Cmd+C / Cmd+V), duplicate (Cmd+D), delete (Del), save (Cmd+S). Problems (unreachable node, port connected twice, missing prompt...) are shown live and block saving. Saving writes `workflows/<id>.workflow.json`; runs already in progress keep the version they started with. "New workflow" copies the default. The run page shows the same cards with each node's live state.
- **Skills page** (`/skills`): edit `SKILL.md` files, create new ones, and **try a skill on a ticket** (read-only, in the project's repo) to tune it before a workflow uses it.

- **After your review** the default workflow continues:
  - **Ticket document** (`doc.write`, skill `ticket-doc`): a detailed document for future readers and AI, written to `docs/<KEY>-<slug>.md` in the repo and committed on the ticket branch (only that file).
  - **Comment on Jira** (`jira.comment`, skill `jira-comment` for tone and structure): the AI drafts; you edit, tick the confirmation and click **Post comment**, or **Skip**. Only the comment is written; status and fields are untouched.
  - **Open pull request** (`git.pr`, skill `pr-description`; not in the default workflow for now, PRs are opened by hand; add the node back in the editor when wanted): the AI drafts title and description; the panel shows the commits that will be pushed and anything left uncommitted. After you confirm, the branch is pushed (`git push --set-upstream`, never `--force`, with your own git credentials) and a Bitbucket PR is opened into the base branch (or the one you choose). If a PR is already open for the branch, its link is returned instead. Nothing is merged.
- **Who implements (agent step)**: when the "Implement" step is reached, the run page asks who does it:
  - **Claude Code CLI**, **Gemini CLI** or **Antigravity CLI** (`agy`) run in the background in the ticket worktree (Gemini and Antigravity: file edits only, no shell).
  - **Antigravity, Antigravity IDE, Cursor or VS Code**: the worktree opens in that app; copy the prompt (approved spec included) into its agent, work there, then click **Done** (or **Couldn't finish**); the run continues with tests, AI review and docs. Your choice is reused if the work loops back (tests or review failed). Set `executor` on the node to skip the question.
  - Read-only AI steps (analysis, spec, review, docs, Jira comment) have an `engine` setting: `claude` (default), `gemini` or `antigravity`, e.g. to save Claude quota.
  - Antigravity CLI: install with `curl -fsSL https://antigravity.google/cli/install.sh | bash` (lands in `~/.local/bin/agy`, override with `ANTIGRAVITY_BIN`) and sign in once by running `agy`. Read-only steps use `--mode plan`; agent runs use `--mode accept-edits`. Shell commands cannot be approved headless, so they are refused.
  - Gemini CLI must be signed in once (`gemini` → Login with Google) and trust the worktree folder (`tesserax/.data/worktrees`) before it may edit files.
- **New task** (Tasks page): local tasks that live only in Tesserax, in the Company or Personal workspace (keys `C-1`, `P-1`; branch `tx/C-1`). Pick the project (repo) so workflows know where to work; edit status or delete them later. Jira tasks stay read-only. The Jira comment step is skipped for local tasks.
- **Code review of a member's PR**: create a task of type **Code review** with the member's branch (and optionally the target branch and the PR link). The routing rule starts the `pr-review` workflow: the branch is checked out read-only in its own worktree (`review__<KEY>`; nothing is pushed), tests run on it, the AI reviews the diff against the target branch (skills `pr-review` + `project-conventions`), you edit/approve the review, then **Comment on the PR** posts it on Bitbucket after you confirm (needs `BITBUCKET_API_TOKEN` with `read:pullrequest`/`write:pullrequest`; otherwise Skip and copy it yourself). The classifier also knows a `review` type.
- **Classify + skip rules**: the default workflow starts with a **Classify** node (Claude CLI, rules as fallback) that labels the ticket bug / feature / chore / research / question and stores it on the run. Any node can have **"skip this node when …"** conditions (AI type, Jira type, project, priority, status, labels, components) and a port to continue through. In the default workflow, question/research tickets skip implement, tests, AI review and the result review. Skipped nodes are shown dashed on the run graph.
- **Which workflow a ticket starts**: rules on the Workflows page (saved to `workflows/routing.json`), e.g. "project is COL → workflow col"; first match wins, otherwise the default. On the Tasks page you can also pick a workflow before clicking "Start workflow".
- **Metrics** (`/metrics`): per workflow version (runs, done rate, your average score per criterion, cost, time), per skill version (how often its output was accepted as-is, edited, or sent back at the next review; cost per use; whether it is the current version), and per node (runs, skips, retries, failures, gate outcomes, your time at gates, pass/fail for checks and reviews), plus your evaluation notes. Use it to see whether a skill or workflow change helped.
- Bitbucket setup (`.env`): `BITBUCKET_API_TOKEN` (an Atlassian API token with Bitbucket scopes `read:repository` and `write:pullrequest`, created at https://id.atlassian.com/manage-profile/security/api-tokens) and `BITBUCKET_EMAIL` if it differs from `JIRA_EMAIL`. The repo is read from the push remote's URL (`git@bitbucket.org:<workspace>/<repo>.git`); otherwise add `"bitbucket": "workspace/repo"` (and `"remote"` if it is not `origin`) to the project in `config/repos.json`.

### Try it without Jira or tokens

```bash
pnpm fake-jira                    # terminal 1: fake Jira with 3 fixture issues (DEMO-1, DEMO-2, OPS-7)
scripts/make-demo-repo.sh         # a throwaway git repo at .data/demo-repo for project DEMO
CLAUDE_BIN=$PWD/scripts/fake-claude.mjs scripts/dev-fake.sh   # terminal 2: API against the fake Jira and a fake CLI
pnpm --filter @tesserax/web dev         # terminal 3: web
```
Then on Tasks, click "Start workflow" on DEMO-1. Drop `CLAUDE_BIN=…` to use the real `claude`.

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

Default JQL: issues assigned to you that are not done, plus those updated in the last 14 days. Reads with `GET /rest/api/3/search/jql`; for new or changed issues it also reads comments (last 20, text) and attachment metadata (never the files). Both plain API tokens and "API tokens with scopes" work (the latter through Atlassian's api.atlassian.com gateway). The only write is a comment, and only after you confirm it in the workflow run view.

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

The bot also sends notifications to everyone on the list for workflow runs: waiting for a person, failed, and done, each with a link to the run page. Confirmations and decisions happen in the web app.

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
| Postgres | 54329 (set `TESSERAX_PG_PORT` and `DATABASE_URL` to change) |

## Other commands

```bash
pnpm typecheck     # tsc in every package
pnpm db:migrate    # run migrations without starting the API
pnpm db:seed
```

See [CLAUDE.md](CLAUDE.md) for the code layout.

## License

Apache License 2.0, see LICENSE.
