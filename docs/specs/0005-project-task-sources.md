# Spec 0005: Project task sources

Status: draft (2026-10-20)

## Goal

Each project says where its tasks come from. In a project's Settings you add task sources (Jira with a JQL, GitHub
Issues with a repository and labels), and every task those sources sync belongs to that project. Local tasks are
always available in every project.

Today there is one Jira source, created from `.env` and owned by the `JIRA_WORKSPACE` project, and project rules
(`jiraKeys`, `sourceIds`, `repositories`) then move its tasks between projects. You cannot see from a project where its
tasks come from, and a broken sync is only visible in the logs.

Builds on spec 0002 (Projects) and the `TaskSource` port (TX-101). GitHub Issues as a source kind is TX-102.

Non-goals: writing status back to the source (moving a Jira ticket, closing an issue), webhooks, credentials in the
database or UI, GitHub Projects (v2).

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | How does a project get its tasks? | It owns its sources. A task's project is its source's project. |
| 2 | How many sources per project? | Any number. Local is always on and is not added by hand. |
| 3 | Where do credentials live? | In `.env`, as named connections. Today's vars are the `default` connection. |
| 4 | What happens to project rules? | Removed. "Move to project…" with a pin stays as the manual override. |
| 5 | Does tesserax write to the source? | Read, plus comments through `task.comment` after confirmation. No status write-back. |

## Connections

A connection is a set of credentials for one provider, read from `.env` at start. Secrets never reach the database,
the API or the UI; the API only lists connection names and whether they are complete.

| Provider | `default` connection | Named connection `<NAME>` |
|---|---|---|
| Jira | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | `JIRA_<NAME>_BASE_URL`, `JIRA_<NAME>_EMAIL`, `JIRA_<NAME>_API_TOKEN` |
| GitHub | `GITHUB_TOKEN` (falls back to `gh auth token`) | `GITHUB_<NAME>_TOKEN` |

`<NAME>` is upper case letters, digits and `_`; it is shown in lower case (`JIRA_WORK_*` → `work`). A source whose
connection is missing or incomplete does not sync and shows "connection `<name>` is not configured in .env".

## Data

`sources` keeps its shape (`id`, `project_id`, `kind`, `name`, `config`, `last_synced_at`, `last_error`) and gains:

| Column | Type | Notes |
|---|---|---|
| `enabled` | bool, default true | a disabled source keeps its tasks but does not sync |
| `last_result` | jsonb, nullable | the last `SyncResult` (inserted, updated, archived, skipped duplicates, truncated) |

`config` per kind, validated by a schema per kind in `@tesserax/contracts`:

```ts
type JiraSourceConfig   = { connection: string; jql: string };                 // jql required, no global default
type GithubSourceConfig = { connection: string; repo: string;                  // "owner/name"
                            labels: string[]; assignee: string | null };       // labels default ["tesserax"]
type LocalSourceConfig  = {};                                                  // one per project, created on demand
```

`projectSettingsSchema` loses `rules`. `tasks.project_id` is set from the source on insert. A sync never changes
`project_id` of an existing task, so a task moved by hand stays where it was put (`project_pinned` is kept for the UI
pin and for moving a task back when it is unpinned).

**Duplicates.** One issue can match sources in two projects (two JQLs overlap). Tasks stay unique per
`(source_id, external_id)`; before inserting, sync checks for a task with the same provider, connection and external id
in another source. If one exists, the issue is skipped and counted in `last_result.skippedDuplicates`, and the source
card says "N issues already belong to project <name>". The first source to sync an issue keeps it.

## Sync

One pg-boss schedule (every ~2 minutes with jitter) loads all enabled, non-local sources and calls
`TaskSourceRegistry.get(kind).sync(source)` for each one, one at a time per connection so a provider's rate limit is
not shared out badly. A failing source writes `last_error` and does not stop the others. "Sync now" on a source runs
it once.

`ensureJiraSource` and the `.env` values `JIRA_JQL` and `JIRA_WORKSPACE` go away after migration; Jira sync reads the
JQL from the source.

## UI

**Project → Settings → Task sources.** One card per source: kind icon, name, connection, the query (JQL or
`owner/name` with labels), enabled toggle, last sync time, last result, last error, "Sync now", "Edit", "Remove".
Local is listed as always on, with no settings.

**Add source.** Pick a kind, pick a connection from the names found in `.env` (a hint names the vars to add when there
is none), fill the query, then "Test" runs the search without saving and shows the first 5 matches and the total.
Saving is allowed only after a test that returned without an error.

**Remove source.** Asks what to do with its tasks: archive them (default) or keep them as they are. Tasks with a run in
progress are never archived.

**Tasks page.** The source filter lists sources of the selected project (all projects in "All").

**System page.** Lists connections per provider with complete / incomplete, never values.

## Migration

One migration, safe to run twice:

1. add `sources.enabled` and `sources.last_result`;
2. for the existing Jira source: set `config.connection = "default"` and `config.jql` to `JIRA_JQL` when set, else to
   today's default JQL written out;
3. for each project with `rules.jiraKeys` that is not the Jira source's project: create a Jira source on the
   `default` connection with `project in (<keys>) AND <today's default JQL>`, and move that project's existing Jira
   tasks to it (keeping their ids);
4. for each project with `rules.repositories`: leave a note on the project page ("add a GitHub source for these
   repositories") rather than guessing labels;
5. drop `rules` from every project's settings.

The app logs a warning at start while `JIRA_JQL` or `JIRA_WORKSPACE` is still set, saying the values now live on the
source.

## Testing

- Connection loading: `default` and named connections, incomplete ones, no secret in any API response (snapshot of
  `GET /system` and `GET /sources`).
- Sync: tasks get the source's project; a pinned task is not moved; a disabled source does not sync; one failing
  source does not stop the next.
- Duplicates: two overlapping sources in different projects, the first keeps the issue, the second counts it.
- Remove source: archive vs keep; a task with a running run is not archived.
- Migration on sample data: Jira source keeps its tasks, `jiraKeys` projects get their own source with their tasks,
  `rules` gone, running twice changes nothing.
- With `scripts/fake-jira.mjs` and the fake GitHub server: a project with one Jira and one GitHub source shows both
  sets of tasks.

## Order of work

1. TX-101 (`TaskSource` port) merged.
2. This spec: connections, source settings UI, sync loop, migration, with Jira only.
3. TX-102 adds the `github` kind on top, using the same settings UI.
