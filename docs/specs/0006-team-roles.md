# Spec 0006: Team (departments and roles for sub agents)

Status: implemented (2026-11-12)

## Goal

Write a sub agent's setup once and reuse it across workflows. Today every AI node repeats its engine, model, tools,
skills and instructions. A **role** (for example `engineering/backend-dev`) holds that setup. A node names the role and
only sets what it needs to change. **Departments** group roles on the Team page.

Non-goals: roles that carry permission modes, environment variables, CLI arguments or binaries; per-role secrets;
roles that grant MCP access on their own.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Name in the UI | **Team** (`/team`), with Departments and Roles. |
| 2 | Where roles live | In the database (`team_departments`, `team_roles`), not in files, so the UI edits them and every edit is audited. |
| 3 | How a node uses a role | `config.role = "<department-slug>/<role-slug>"` on `ai.step`, `ai.review`, `doc.write`, `jira.comment`, `git.pr` and `agent.run`. |
| 4 | Precedence | run override > field set in the node > role > project default > the node type's default. The project's `engines.allowed` is still enforced last. |
| 5 | Prompt | The role prompt goes first as `# Role: <title>`, then the skills, then the task prompt. |
| 6 | Skills | The role's skills, then the node's own, each once. The project's skill list still applies. |
| 7 | Tools | A role can only narrow tools: node tools ∩ role tools when the node lists them, else the role's tools. Every role tool must be on `ROLE_TOOL_ALLOWLIST`. |
| 8 | MCP | A role's MCP servers/tools only become the node's request to `McpService.grantFor`. The MCP policy (System page) still decides what is granted. |
| 9 | Projects | `settings.roles: string[] \| null` (null = every role). A step whose role is not allowed fails. |
| 10 | Versioning | `role_hash = sha256({prompt, config})`, first 12 hex characters (keys sorted). Each step stores `node_runs.role` and `role_hash`. |

## Data model

Migration `014_team`:

- `team_departments(id uuid pk, slug text unique, name, color default '#64748b', description default '', position, created_at, updated_at)`
- `team_roles(id uuid pk, department_id → team_departments on delete restrict, slug, title, prompt default '', config jsonb default '{}', enabled default true, position, created_at, updated_at, unique(department_id, slug))`
- `team_role_changes(id, role_id, role_key, old_hash, new_hash, action, at)`: audit trail. The service writes it in the same transaction as each role create, update or delete.
- `node_runs.role`, `node_runs.role_hash`

When both team tables are empty, `TeamService.onModuleInit` adds a starter team: `engineering/backend-dev`,
`qa/reviewer` and `docs/tech-writer`. Their prompts are stack-agnostic and their tools are on the allow-list.

## Module and API

`@tesserax/mod-team` (`packages/modules/team`), registered as `TeamModule.forRoot({ workflowUsage })`, global.

- It provides `ROLE_LOOKUP` (`RoleLookup` in `@tesserax/contracts`: `getByKey`, `keys`). The workflow engine reads roles only through this token.
- It needs `WORKFLOW_USAGE` (`WorkflowUsage`: `usedBy(key)`). The host binds it to `WorkflowStore.usingRole`, so team never imports the workflow module.
- Routes:
  - `GET /api/team?project=<slug>`
  - `POST /api/team/departments`
  - `PATCH` and `DELETE /api/team/departments/:id`
  - `POST /api/team/roles`
  - `PATCH` and `DELETE /api/team/roles/:id`
  - `GET /api/team/roles/:id/changes`
- Each body is validated with the contract schemas. `PATCH` merges onto the stored row, then validates the result.
- The api answers 409 when you:
  - rename a role or department slug while a workflow uses the key
  - delete a role that a workflow uses
  - delete a department that still has roles
  - create a key that already exists

At run time (`jobs.ts` `runNodeJobInner` and `HandoffService.choose`):

1. `resolveRole` looks the role up. A missing or disabled role, or one the project does not allow, fails the step with `FatalNodeError`.
2. `applyRole` re-checks the stored role, fills the raw node config and narrows its tools. Then the node type's schema parses the result.
3. The run overrides (`applyRunOverrides`) and the project's engine rules run next, as before.
4. The executors build the prompt with `withRole(role, withSkills(prompt, [...roleSkills, ...nodeSkills]))`.

The api reports `Node "X" uses unknown role "Y"` among a workflow's problems (`roleProblems`), and the editor shows it on the node.

## Security notes

- `roleConfigSchema` is strict. Unknown keys fail, so `permissionMode`, `env`, `args`, `bin` and flags cannot be stored.
- Tools come only from `ROLE_TOOL_ALLOWLIST` (Read, Grep, Glob, Edit, MultiEdit, Write and the git status/diff/log/show/add/commit Bash patterns). `Bash(*)`, bare `Bash` and `WebFetch` are refused.
- Caps: budget ≤ 20 USD, timeout ≤ 7200 s, prompt ≤ 20,000 characters, ≤ 20 skills, ≤ 50 tools, ≤ 20 MCP servers.
- `containsSecret` refuses text that looks like a credential in the title, prompt and every config string. It catches GitHub tokens, `sk-` keys, Slack tokens, AWS access key ids and PEM blocks.
- A role row edited directly in the database is parsed again when a step uses it. An invalid role fails the step; it never widens what the agent may do.
- Row level security is enabled on the three team tables with no policies. Only the api's own database role uses them.
- The api refuses requests whose `Host` header is not one it serves (loopback on the api or web port, `API_HOST`, the host of `WEB_BASE_URL`). This blocks DNS-rebinding pages from reaching the local API.
