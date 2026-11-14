# Spec 0007: Context (what a role reads, and how it gets better)

Status: implemented (2026-11-14)

## Goal

A role's prompt says how to work. What it has to **know** (project facts, scope, schedule, design rules) is shared
between roles and changes more often. Until now that knowledge was pasted into each role prompt, so nobody could see
which role read what, and one prompt limit covered both.

1. **Context packs**: pieces of knowledge kept once, switched on per role, with a hard line for what a role may never read.
2. **A page that shows the scope**: per role what it reads now, what it could read, what it may not, and its size against the limit.
3. **Self-improvement with a person in the loop**: a role proposes how to do its job better; nothing changes until the person approves.

Non-goals: packs that carry secrets; a role editing its own prompt or packs; retrieval (packs are sent whole).

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Name in the UI | **Context** (`/context`), views *By role*, *Matrix*, *Proposals*. |
| 2 | Where packs live | `team_context_packs` (slug, name, description, body, source, audience, pinned). The body is Markdown, at most 20,000 characters, refused when it looks like it holds a token. |
| 3 | What a role may read | The pack's **audience**: `null` = every role, else a list of role keys. Outside the audience a pack is *not allowed* and is not even named to the role. |
| 4 | What a role reads | Inside the audience: a **pinned** pack is always on (shared memory); the others are on when their slug is in `team_roles.config.context`. |
| 5 | Where the switch is stored | In the role's `config`, so a switch is a role edit: audited in `team_role_changes`, and the role hash changes. |
| 6 | Limit | Role prompt + context text at most 60,000 characters (`CONTEXT_LIMITS.roleChars`). A switch or an approval that would pass it is refused; a pack edit that passes it is saved and the role shows *over the limit*. |
| 7 | Prompt order | `# Role: <title>`: role prompt, role card, then `## Context: <pack>` sections, the names of the allowed packs it was **not** given, the approved lessons and the last rejected proposals. Then skills, then the task. |
| 8 | Runs | The context text is part of the role snapshot taken when a run starts (`workflow_runs.vars.roles[key].context`), like the prompt. |
| 9 | Who proposes | The role itself, at the end of a step: the step report has an optional section **Improvement proposals** (`Đề xuất cải tiến`). Also the MCP tool `propose_improvement` and `POST /team/roles/{id}/improvements` (sessions outside a run, or the person). |
| 10 | Who decides | Only the person, on the Context page. No MCP tool approves or rejects. |
| 11 | What approval does | A **lesson** joins the role's context (the person may reword it first). A **context request** switches the pack on, only inside the audience. |
| 12 | What rejection does | The proposal and the person's note are shown to the role (the last 5), and the same proposal is dropped if made again. |

## Data model

- `team_context_packs`: `id`, `slug` (unique), `name`, `description`, `body`, `source`, `audience jsonb` (null or role keys), `pinned`, `position`, timestamps.
- `team_roles.config.context: string[]`: slugs switched on for the role (pinned packs need no entry).
- `team_improvements`: `id`, `role_id` (cascade), `role_key`, `kind` (`lesson` | `context`), `text`, `reason`, `pack`, `source`, `status` (`proposed` | `approved` | `rejected` | `retired`), `note`, `fingerprint`, `created_at`, `decided_at`.

Row level security is on with no policies, as for the other team tables.

## States of a pack for a role

| State | Meaning | In the UI |
|---|---|---|
| pinned | in the audience, always on | lock, cannot be switched off for one role |
| on | in the audience, switched on | *Switch off* |
| off | in the audience, switched off; the role is told its name and may ask for it | *Switch on* |
| blocked | outside the audience; the role is not told it exists | *Not allowed*; change the pack's audience to allow it |

`contextState` and `resolveContext` in `@tesserax/contracts` (`context.ts`) are the one place this is decided; the API and the page both use them.

## The improvement loop

1. A role-driven step is told to end its report with the usual block. The block has an optional last section:

   ```
   ## Improvement proposals
   - <a rule that would make this role do better next time> | <what happened>
   - context: <pack slug> | <why>
   ```

   The instruction asks for it above all when the work was sent back (the rule that would have avoided it) and when the
   task needed context the role was not given. At most 3 lines per step.
2. `parseStepReport` reads the section; `keepImprovements` (workflow `jobs.ts`) hands the items to the Team module through
   `RoleLookup.proposeImprovements`. This never fails a step.
3. `ContextService.proposeImprovements` keeps what is new: a proposal with the same text (case, spacing and end
   punctuation ignored) as one already waiting, approved or rejected is dropped; a role has at most 20 waiting.
   A context request must name an existing pack the role does not read yet.
4. The person decides on **Context → Proposals** (or in the role's own panel): approve (optionally reworded), reject with a
   note, later retire an approved lesson. A role keeps at most 30 lessons; past that, merge them into the role's prompt.
5. From its next run the role reads the approved lessons under *Lessons for this role*, and the rejected ones under
   *Proposals the owner turned down*.

Lessons are deliberately not written into the role prompt: the prompt stays the person's text, and every lesson can be
traced to the step that proposed it (`source = run:<run id>:<node id>`) and retired on its own.

## API

| Route | What |
|---|---|
| `GET /team/context` | Packs and, per role: using, pinned, available, blocked, stale, lessons, waiting proposals, characters. |
| `GET /team/context/roles/{id}` | One role and the exact context text its steps are sent. |
| `PUT /team/context/roles/{id}` | `{ packs: string[] }`: the switches of a role. |
| `PUT /team/context/packs/{slug}` · `DELETE …` | Create or replace, delete a pack. |
| `GET /team/improvements?status=&role=` | Proposals, newest first. |
| `POST /team/roles/{id}/improvements` | Propose (`kind`, `text`, `reason`, `pack`, `source`). |
| `POST /team/improvements/{id}/decision` | `{ decision: approve \| reject \| retire, note?, text? }`. |

MCP: `get_role_context` (read), `propose_improvement` (act). See [ai-control.md](../ai-control.md).

## Keeping packs in a repository

A project can keep its packs as files and push them with the API (`PUT /team/context/packs/{slug}` is an upsert), using
an audience made of that project's role keys so other projects' roles cannot read them. Switches and lessons then live
in Tesserax and can be read back from `GET /team/context` and `GET /team/improvements`.

## Tests

- `packages/contracts/src/report.test.ts`: the proposals section of the step report.
- `packages/modules/team/src/context.service.test.ts`: states, audience, limit, secrets, the proposal rules.
- `packages/modules/workflow/src/apply-role.test.ts`, `jobs.test.ts`: context in the prompt and the snapshot; proposals leave the step.
- `apps/mcp/src/tools.test.ts`: the two tools; no tool decides.
