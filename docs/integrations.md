# Integrations

All integrations are optional. Put the keys in `.env` and restart `pnpm dev`. The System page shows which ones are configured.

## Jira Cloud

Tasks are synced from Jira, read-only, every ~2 minutes and on start. "Sync now" on the Tasks page queues one right away. Issues the query stops returning are archived, not deleted.

1. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens
2. In `.env`:
   ```
   JIRA_BASE_URL=https://your-site.atlassian.net
   JIRA_EMAIL=you@example.com
   JIRA_API_TOKEN=...
   # optional
   JIRA_JQL=project = PAY AND statusCategory != Done ORDER BY updated DESC
   ```
3. Restart `pnpm dev`. The System page shows "Jira Cloud: configured".

Default JQL: issues assigned to you that are not done, plus those updated in the last 14 days. Reads use `GET /rest/api/3/search/jql`; for new or changed issues it also reads comments (last 20, text) and attachment metadata (never the files). Both plain API tokens and "API tokens with scopes" work (the latter through Atlassian's api.atlassian.com gateway).

**The only write to Jira is a comment, and only after you confirm it.** Status and fields are never touched.

### Testing without a Jira account

```bash
pnpm fake-jira    # fake Jira on http://127.0.0.1:4499 serving fixtures/jira/issues.json
```

and in `.env`: `JIRA_BASE_URL=http://127.0.0.1:4499`, `JIRA_EMAIL=dev@example.com`, `JIRA_API_TOKEN=fake`.

To run without the real `claude` CLI too, `scripts/fake-claude.mjs` stands in for it (`CLAUDE_BIN=$PWD/scripts/fake-claude.mjs`), and `scripts/make-demo-repo.sh` creates a throwaway git repo at `.data/demo-repo` to point a workplace at.

## Bitbucket

Used by the `git.pr` node and the PR-review workflow.

- `BITBUCKET_API_TOKEN`: an Atlassian API token with Bitbucket scopes `read:repository` and `write:pullrequest`, created at https://id.atlassian.com/manage-profile/security/api-tokens. For commenting on PRs it also needs `read:pullrequest`.
- `BITBUCKET_EMAIL` if it differs from `JIRA_EMAIL`.
- The repository is read from the push remote's URL (`git@bitbucket.org:<workspace>/<repo>.git`).

Pushing uses your own git credentials. Nothing is merged.

## Telegram bot (read-only)

Long polling with grammY, so no public URL or webhook is needed. The bot runs inside the API process.

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. In `.env`: `TELEGRAM_BOT_TOKEN=...` and `TELEGRAM_ALLOWED_USER_IDS=<your numeric id>` (comma-separated for several). Don't know your id? Start the bot with the list empty and send it a message: it replies with your id.
3. Restart `pnpm dev`.

Commands: `/tasks` (open Jira tasks), `/agents` (Claude Code sessions, who needs you), `/mcp` (enabled MCP servers), `/help`. Anyone not on the list gets no data.

## Ports

| What | Port |
|---|---|
| Web (Vite) | 5180 |
| API (NestJS) | 4400 |
| Postgres | 54329 (set `TESSERAX_PG_PORT` and `DATABASE_URL` to change) |
