# Spec 0002: Projects

Status: draft for review (2026-10-16)

## Goal

Let one person run several projects side by side. Each project is its own space: its tasks, its workplaces, the
workflows and skills it uses, its agent engines and its variables. Picking a project filters the whole UI to it;
"All" shows every project at once so nothing waiting for you is hidden.

Today "project" only means a Jira project key (`tasks.project`, `Workplace.projects`), and workflows, skills and
routing are global. That is not enough when projects need different workflows, skills and test commands.

Non-goals for this spec (later, built on top of it): phases/milestones inside a project, KPIs per project, importing a
phase plan from markdown, GitHub Issues/Milestone sync, per-project private workflows or skills, parallel-run limits.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | What is a project for? | A separate space (tasks, workplaces, workflows, skills, engines). Planning comes later. |
| 2 | How does a task join a project? | By rules (Jira key, source, repository), first match wins; you can move a task by hand and it stays pinned. One project per task. |
| 3 | How do workflows and skills belong to a project? | One shared library; each project enables what it uses and has its own routing and variables. |
| 4 | How do agents belong to a project? | By folder: a session whose cwd is inside a project's workplace or a run worktree belongs to it. Each project picks a default engine and the allowed engines. |
| 5 | What about the `workspaces` table? | It becomes `projects`. Existing rows become projects with the same ids. |
| 6 | UI | A project picker in the top bar (All / one project), a projects page, and per-project overview and settings pages. |

## Module and data

New module `@tesserax/mod-projects` (`packages/modules/projects`). It owns the `projects` table and is the only
module that reads or writes it.

Table `projects` (renamed from `workspaces`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | kept from `workspaces.id` |
| `slug` | text, unique | used in URLs and `?project=` |
| `name` | text | |
| `color` | text | hex, for the dot shown next to rows in "All" |
| `kind` | `personal` \| `company` | kept from `workspaces.kind` |
| `position` | int | order in which rules are tried and projects are listed |
| `is_default` | bool | exactly one row; receives tasks no rule matches ("Unsorted") |
| `settings` | jsonb | validated by `projectSettingsSchema` in `@tesserax/contracts` |
| `created_at` | timestamptz | |

`projectSettingsSchema`:

```ts
{
  rules: {                       // a task matches when any listed value matches
    jiraKeys: string[];          // e.g. ["TC", "COL"], matched against tasks.project
    sourceIds: string[];         // every task of these sources
    repositories: string[];      // repository ids from the Repos module (GitHub source tasks)
  };
  workplaceIds: string[];        // workplaces runs of this project may use; the first is the default
  workflows: string[];           // enabled workflow ids
  skills: string[];              // enabled skill names
  routing: Routing;              // same shape as workflows/routing.json today
  engines: { default: string; allowed: string[] };
  vars: Record<string, string>;  // e.g. { "test_command": "pnpm typecheck && pnpm test" }
}
```

Column changes:

- `tasks.workspace_id` → `tasks.project_id`; new `tasks.project_pinned boolean default false`.
- `sources.workspace_id` → `sources.project_id`.
- `workflow_runs.project_id` (copied from the task when the run starts, for filtering).
- `agent_sessions.project_id` (nullable: null means "Not in a project").

### Contract

Other modules depend on the contract, never on the table. Declared in `@tesserax/contracts`, provided by the
projects module under the token `PROJECT_DIRECTORY`:

```ts
interface ProjectDirectory {
  list(): Promise<Project[]>;
  get(idOrSlug: string): Promise<Project | null>;
  resolveForTask(task: TaskFacts): Promise<Project>;        // never null: falls back to the default project
  resolveForPath(cwd: string): Promise<Project | null>;     // null when the folder belongs to no project
}
```

Declared dependencies:

- tasks, workflow, agents → projects (through `PROJECT_DIRECTORY`)
- projects → repos (to turn workplace ids into paths)
- skills does **not** depend on projects: `@tesserax/mod-skills` is extractable and imports nothing from the host. The
  workflow engine checks a skill against the project's `skills` list before a node uses it, and the host's Skills page
  marks enabled skills from the project settings it already has.

## Flows

**A task joins a project.** On Jira sync and on manual creation, the tasks module calls `resolveForTask`. Projects
are tried in `position` order; the first whose rules match takes the task. A pinned task is never moved by sync. No
match → the default project. Moving a task by hand ("Move to project…") sets `project_id` and `project_pinned`.
Unpinning lets the rules decide again on the next sync.

**A run starts.** The engine loads the task's project and:

1. picks the workflow with the project's `routing` (the global `workflows/routing.json` is no longer read at run time;
   its content becomes the default project's routing);
2. picks the workplace: the one set on the task if the project allows it, else the project's first workplace;
3. adds the project's variables to the template context as `{{project.<name>}}` (also exported to shell steps as
   `TX_PROJECT_<NAME>`), and stores them in `run.vars.project` so a retry uses the values the run started with;
4. refuses a workflow, engine or workplace the project does not enable, with a clear error.

When a node uses a skill the project does not enable, that node fails with "skill <name> is not enabled in project
<name>" and the run waits at the usual failure point; it never runs silently without the skill.

**An agent session reports in.** The agents module calls `resolveForPath(cwd)` when a session starts (and when its cwd
changes). A cwd inside a project workplace path, or inside the worktree of a run of that project, belongs to that
project. Otherwise the session stays in "Not in a project".

**Configuration errors.**

- Two projects claiming the same Jira key or source: saving settings fails and names the other project.
- A workplace removed from Repos while a project lists it: the project page shows a warning, and new runs of that
  project fail to start until the setting is fixed. Running runs are not touched.
- Deleting a project moves its tasks and sources to the default project. The default project cannot be deleted.

## UI

- **Top bar:** a project picker (All / each project). The choice is kept in local storage and sent with every API call
  as `?project=<slug>`. Tasks, Runs and Agents filter by it. Workflows and Skills mark which items the project
  enables. In "All", every row shows the project's color dot.
- **`/projects`:** one card per project with tasks in progress, tasks waiting for you, and recent failed runs.
- **`/projects/:slug`:** an Overview tab (the counts above and the list of gates waiting for you) and a Settings tab
  (rules, workplaces, enabled workflows and skills, routing, engines, variables).
- **Tasks page:** a "Move to project…" action; a pinned task shows a pin.
- **Naming:** the Jira project key is shown as "Board" everywhere in the UI, so it is not confused with a Project.

## Migration

One migration, safe to run twice:

1. rename `workspaces` → `projects` and the `workspace_id` columns → `project_id`; add the new columns;
2. give every existing row a slug, a color and empty settings; mark the oldest row as the default project;
3. fill the default project's `routing` from `workflows/routing.json`, its `workflows` and `skills` with everything
   that exists, its `workplaceIds` with every workplace, and its `rules.jiraKeys` with the Jira keys listed on
   workplaces.

On the first start after the migration, every unpinned task is resolved again against the rules.

## Testing

- `resolveForTask`: rule order, each rule kind, pinned tasks, no match → default project.
- `resolveForPath`: inside a workplace, inside a run worktree, outside both, nested paths.
- Migration on sample data: ids kept, default project filled, running twice changes nothing.
- Engine: routing and variables come from the task's project; a disabled workflow, engine or skill is refused; a
  retry reuses the stored variables.
- Settings validation: duplicate Jira key or source across projects is rejected.
- Module boundary test (as in the skills module): only `mod-projects` touches the `projects` table.
