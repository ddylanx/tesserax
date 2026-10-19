# Agents

## Who implements

When a run reaches an `agent.run` step, the run page asks who does it:

- **Claude Code CLI**, **Gemini CLI** or **Antigravity CLI** (`agy`) run in the background in the ticket worktree. Gemini and Antigravity can edit files but cannot run shell commands.
- **Antigravity, Antigravity IDE, Cursor or VS Code**: the worktree opens in that app. Copy the prompt (approved spec included) into its agent, work there, then click **Done** (or **Couldn't finish**). The run continues with tests, AI review and docs. Your choice is reused if the work loops back because tests or review failed. Set `executor` on the node to skip the question.

Agent runs never push or merge. Push, merge, rebase, remote changes, `gh`, `curl` and `rm -rf` are always denied (see `ALWAYS_DENIED` in `packages/agent-runtime/src/launcher.ts`).

## Engine for read-only steps

Read-only AI steps (analysis, spec, review, docs, Jira comment) have an `engine` setting: `claude` (default), `gemini` or `antigravity`. Use it to save Claude quota.

## Setting up Gemini and Antigravity

- **Antigravity CLI**: install with `curl -fsSL https://antigravity.google/cli/install.sh | bash`. It lands in `~/.local/bin/agy`; override with `ANTIGRAVITY_BIN`. Sign in once by running `agy`. Read-only steps use `--mode plan`; agent runs use `--mode accept-edits`. Shell commands cannot be approved headless, so they are refused.
- **Gemini CLI**: sign in once (`gemini` → Login with Google) and trust the worktree folder (`.data/worktrees` in your checkout) before it may edit files. `GEMINI_BIN` sets the binary.

What the CLI's output means (logged out, usage limit, budget, timeouts…) is in [ADR 0003](adr/0003-agent-cli-signals.md). The `claude` CLI must be signed in: run `claude` in a terminal and use `/login`.

## Agents page: Claude Code sessions

The Agents page (`/agents`) lists Claude Code sessions on this machine: running, needs you, idle, ended; folder, git branch, last activity, prompt and tool counts, token usage. Click a row for its recent events. It is fed by Claude Code hooks.

### Connect Claude Code

Claude Code reports each session to `POST http://127.0.0.1:4400/api/agents/events` through hooks: every hook pipes its JSON to `curl`. The command fails silently (2 s timeout, `|| true`), so Claude Code is never blocked when Tesserax is off.

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

### What is stored

Session id, folder, branch (read from `.git/HEAD`), model, status, last tool, the first 300 characters of your last prompt, notification text, and per event a short target (file path or command, 160 characters). Hooks carry no token counts, so usage is read from the session's transcript file (`transcript_path`, numbers and model name only). Tool output and file contents are never stored. Events older than 14 days are pruned; sessions silent for 12 hours are marked ended.

## MCP page

The MCP page (`/mcp`) lists every MCP server configured on this machine (Claude Code user, local and project scopes, Cursor, Claude Desktop, Codex, Gemini, Antigravity), with on/off state, read-only. Only names, transport and env key names are read, never values.
