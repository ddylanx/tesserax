# Contributing

Thanks for helping. Tesserax is a pnpm + Turborepo monorepo, TypeScript strict, package scope `@tesserax/`.

## Dev setup

Requirements are in the [README](README.md#requirements).

```bash
cp .env.example .env
pnpm install
pnpm dev          # Postgres (Docker), API on :4400, web on :5180
```

The API does not restart on file changes, so running steps are not interrupted. Restart `pnpm dev` after editing API code, or use `pnpm --filter @tesserax/api dev:watch`.

Other commands:

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc` in every package |
| `pnpm test` | Tests in every package |
| `pnpm db:migrate` | Run migrations without starting the API |
| `pnpm db:seed` | Seed the database |
| `pnpm db:down` | Stop Postgres (data is kept) |
| `pnpm docs:check` | Check that relative links in the docs resolve |

## Before you open a PR

`pnpm typecheck`, `pnpm test` and `pnpm docs:check` must pass. Fill in the [pull request template](.github/pull_request_template.md): Before, After, How.

## Commit convention

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, for example `feat(workflow): ...` or `fix(security): ...`. Keep the summary short and in the imperative.

## Module rules

- Packages are consumed as TypeScript source (no build step). The API runs with `@swc-node/register` (decorator metadata on).
- Inject infrastructure with the tokens from `@tesserax/core` (`CONFIG`, `DB`, `QUEUE`, `SCHEDULES`) using `@Inject(...)`.
- Register job handlers and schedules in a module's `onModuleInit`.
- A new table needs a migration file, registered in `migrations/index.ts`, and the `Database` type in `packages/db/src/schema.ts` extended.
- A new endpoint starts with its response schema and type in `@tesserax/contracts`, then api and web use it.
- Extractable modules (currently `@tesserax/mod-skills`) import nothing from the host: no `@tesserax/*`, no `@/*`. Host things come in through `forRoot` options. `boundary.test.ts` enforces it.
- Never log or store secrets. Use `createLogger(scope)` for logs.
- Issue text is untrusted: keep it inside `<issue>` delimiters in every prompt.
- Agent runs never push or merge.
- Everything binds to 127.0.0.1.

See [CLAUDE.md](CLAUDE.md) for the code layout.

## Writing a skill

A skill is a Markdown prompt at `skills/<name>/SKILL.md` that a workflow node uses. `skills/` is gitignored and created from `examples/skills/` on first `pnpm dev`, so start by copying a similar example. To share a skill with everyone, add it under `examples/skills/`.

Use the **Skills** page (`/skills`) to edit it and to **try the skill on a ticket** (read-only) before a workflow uses it.

## Writing a workflow

A workflow is a graph in `workflows/<id>.workflow.json`, also created from `examples/workflows/`. Build it in the editor on the **Workflows** page (it validates as you go), or edit the JSON. To share one, add it under `examples/workflows/`. Node types and the editor are described in [docs/workflows.md](docs/workflows.md).

## Bugs and features

Open an issue with the bug or feature form. For security problems, do not open an issue: see [SECURITY.md](SECURITY.md).
