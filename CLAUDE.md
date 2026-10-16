# Tesserax (local mode)

Personal backoffice for AI coding work. pnpm + Turborepo monorepo, TypeScript strict, package scope `@tesserax/`.

## Layout
- `apps/api` NestJS. In local mode it also runs pg-boss workers and schedules (no separate worker app yet).
- `apps/web` React + Vite + TanStack Router/Query + Tailwind 4 + shadcn-style components in `src/components/ui`.
- `packages/config` Zod-validated env, loads `<repo>/.env`.
- `packages/contracts` Zod schemas + types shared by api and web (the API contract).
- `packages/core` WorkContext (AsyncLocalStorage correlationId), pino logger, `Queue` (pg-boss wrapper), `ScheduleRegistry`, Nest injection tokens.
- `packages/db` Kysely client, schema types, migrations (`src/migrations`, registered in `migrations/index.ts`), seed.
- `packages/agent-runtime` git/worktree/diff helpers, Claude CLI runner, detached launcher; plain TS, no Nest.
- `packages/modules/*` feature modules (`@tesserax/mod-*`), each a Nest module with `jobs/` for its pg-boss handlers.
- `packages/modules/classify` `ClassifyModule`, `ClassificationService`: rules engine + Claude CLI classifier; used by pipeline and workflow.
- `packages/modules/pipeline` the automation pipeline: state machine (`states.ts`, `PipelineService.transition`), step jobs in `jobs/`.
- `packages/modules/workflow` node-based workflow engine (spec: `docs/specs/0001-workflow-engine.md`): `engine.service.ts` (runs, routing, gates, loops), `executors/` (one per node type), `jobs.ts`. Workflows in `workflows/*.workflow.json` (gitignored, start from `examples/workflows/`), reads skills through `SkillCatalog` from `@tesserax/mod-skills` (gitignored, start from `examples/skills/`); node config schemas in `@tesserax/contracts` (`workflow.ts`).
- `packages/modules/skills` (`@tesserax/mod-skills`) self-contained, extractable module: the repo's own skills (`skills/<name>/SKILL.md`) and external packages (git repos installed into `skills/_packages/<id>/`, only .md/.txt text plus LICENSE; manifest `skills/packages.json`). Entries: `.` (Nest `SkillsModule.forRoot`, `SkillCatalog`), `./contracts`, `./web` (React). It must not import `@tesserax/*` or `@/*` (enforced by `boundary.test.ts`); host things come in through `forRoot` options.
- `packages/modules/projects` (`@tesserax/mod-projects`) projects (spec: `docs/specs/0002-projects.md`): the `projects` table (was `workspaces`) and `ProjectsService`, provided globally under `PROJECT_DIRECTORY` (contract `ProjectDirectory` in `@tesserax/contracts`): `resolveForTask` (first project by position whose rules match, else the default project), `resolveForPath` (run worktree, then workplace folders), `reassign`. Tasks, workflow and agents depend on the contract, never on the table. A project's `settings` hold task rules (Jira keys = "Board" in the UI, sources, repositories), workplaces, enabled workflows/skills (null = all), routing, engines and variables (`{{project.<name>}}`, `$TX_PROJECT_<NAME>`). A task you move by hand is `project_pinned`; sync never moves it.
- `packages/modules/repos` repos registry (Repos page): repositories (origin, base branch) and their workplaces (a local checkout per brand, with the Jira projects that default to it), stored in `config/workplaces.json` (gitignored; created from `config/repos.json` the first time). A task runs in its picked workplace (`tasks.workplace_id`), else the first workplace registered for its project; resolve with `repoRegistry.resolve(task)`.
- `playbooks/*.md` playbook definitions (older pipeline) (frontmatter + prompt template). `config/repos.json` (gitignored) is the legacy project → repo map, still read as a fallback.
- `.data/` (gitignored) worktrees and run logs. `scripts/fake-jira.mjs`, `scripts/fake-claude.mjs`, `fixtures/` for testing without accounts.
- `infra/compose.dev.yml` Postgres 16 (pgvector image) on 127.0.0.1:54329.

## Rules
- Packages are consumed as TS source (no build step). The api runs with `@swc-node/register` (decorator metadata on).
- Inject infra with tokens from `@tesserax/core` (`CONFIG`, `DB`, `QUEUE`, `SCHEDULES`) using `@Inject(...)`.
- Register job handlers / schedules in a module's `onModuleInit`; the queue starts in `InfraModule.onApplicationBootstrap`.
- New table: add a migration file, register it, extend `Database` in `packages/db/src/schema.ts`. Migrations + seed run when the api boots.
- New endpoint: define the response schema/type in `@tesserax/contracts` first, then use it in api and web.
- Everything binds to 127.0.0.1; no auth in local mode. Never log or store secrets; `.env` is gitignored.
- Pipeline state only changes through `PipelineService.transition` (guarded UPDATE + event). Steps start via `startStep` and run inside `runStep` (stale-job skip, retries, then failed).
- Issue text is untrusted: keep it inside `<issue>` delimiters in every prompt. Never write to Jira except `postJiraComment`, which needs an explicit confirmed click.
- Agent runs never push or merge (see `ALWAYS_DENIED` in `packages/agent-runtime/src/launcher.ts`).
- Logs: use `createLogger(scope)`; correlationId is added automatically inside a WorkContext (HTTP requests, jobs, bot updates).
- Extractable modules (currently @tesserax/mod-skills) follow these rules: no host imports, own contracts, forRoot options/ports, peer deps for shared libs.
- A run reads its routing, enabled workflows, allowed engines and variables from the task's project (`WorkflowEngine.startRun`, `jobs.ts`); skills outside the project's list fail the step (`project-skills.ts`). `@tesserax/mod-skills` stays free of project code.

## Commands
`pnpm dev` (starts Postgres in Docker, api on :4400, web on :5180; the api does not restart on file changes so running steps are not interrupted: restart `pnpm dev` after editing api code, or use `pnpm --filter @tesserax/api dev:watch`) · `pnpm typecheck` · `pnpm test` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:down`
