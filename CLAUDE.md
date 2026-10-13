# Open Tesseract (local mode)

Personal backoffice for AI coding work. pnpm + Turborepo monorepo, TypeScript strict, package scope `@ot/`.

## Layout
- `apps/api` NestJS. In local mode it also runs pg-boss workers and schedules (no separate worker app yet).
- `apps/web` React + Vite + TanStack Router/Query + Tailwind 4 + shadcn-style components in `src/components/ui`.
- `packages/config` Zod-validated env, loads `<repo>/.env`.
- `packages/contracts` Zod schemas + types shared by api and web (the API contract).
- `packages/core` WorkContext (AsyncLocalStorage correlationId), pino logger, `Queue` (pg-boss wrapper), `ScheduleRegistry`, Nest injection tokens.
- `packages/db` Kysely client, schema types, migrations (`src/migrations`, registered in `migrations/index.ts`), seed.
- `packages/modules/*` feature modules (`@ot/mod-*`), each a Nest module with `jobs/` for its pg-boss handlers.
- `packages/modules/pipeline` the automation pipeline: state machine (`states.ts`, `PipelineService.transition`), step jobs in `jobs/`, classifiers in `classify/`, Claude CLI runner + worktrees in `agent/`.
- `packages/modules/workflow` node-based workflow engine (spec: `docs/specs/0001-workflow-engine.md`): `engine.service.ts` (runs, routing, gates, loops), `executors/` (one per node type), `jobs.ts`. Workflows in `workflows/*.workflow.json`, skills in `skills/*/SKILL.md`; node config schemas in `@ot/contracts` (`workflow.ts`).
- `packages/modules/skill-packages` external skill packages: git repos installed into `skills/_packages/<id>/` (only SKILL.md/.md text, plus LICENSE), manifest `skills/packages.json` (source, ref, commit, version, category). Package skills are referenced by path like any skill.
- `playbooks/*.md` playbook definitions (older pipeline) (frontmatter + prompt template). `config/repos.json` (gitignored) maps Jira project → local repo.
- `.data/` (gitignored) worktrees and run logs. `scripts/fake-jira.mjs`, `scripts/fake-claude.mjs`, `fixtures/` for testing without accounts.
- `infra/compose.dev.yml` Postgres 16 (pgvector image) on 127.0.0.1:54329.

## Rules
- Packages are consumed as TS source (no build step). The api runs with `@swc-node/register` (decorator metadata on).
- Inject infra with tokens from `@ot/core` (`CONFIG`, `DB`, `QUEUE`, `SCHEDULES`) using `@Inject(...)`.
- Register job handlers / schedules in a module's `onModuleInit`; the queue starts in `InfraModule.onApplicationBootstrap`.
- New table: add a migration file, register it, extend `Database` in `packages/db/src/schema.ts`. Migrations + seed run when the api boots.
- New endpoint: define the response schema/type in `@ot/contracts` first, then use it in api and web.
- Everything binds to 127.0.0.1; no auth in local mode. Never log or store secrets; `.env` is gitignored.
- Pipeline state only changes through `PipelineService.transition` (guarded UPDATE + event). Steps start via `startStep` and run inside `runStep` (stale-job skip, retries, then failed).
- Issue text is untrusted: keep it inside `<issue>` delimiters in every prompt. Never write to Jira except `postJiraComment`, which needs an explicit confirmed click.
- Agent runs never push or merge (see `ALWAYS_DENIED` in `agent/launcher.ts`).
- Logs: use `createLogger(scope)`; correlationId is added automatically inside a WorkContext (HTTP requests, jobs, bot updates).

## Commands
`pnpm dev` (starts Postgres in Docker, api on :4400, web on :5180) · `pnpm typecheck` · `pnpm test` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:down`
