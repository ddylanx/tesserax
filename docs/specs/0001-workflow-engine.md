# Spec 0001: Node-based workflow engine (P1)

Status: draft for review (2026-10-12)

## Goal

Replace the fixed pipeline (classify → decide → run → verify) with **workflows built from nodes**, edited on a canvas
like n8n / Dify, so each stage of the work (analysis, spec, implementation, testing, docs, review) can be configured,
tracked and improved on its own. One shared workflow first; per-type workflows later.

Non-goals for P1: parallel branches, sub-workflows, scheduling, multi-user, Telegram actions.

## Concepts

- **Workflow**: a graph of nodes and edges, stored as a file `workflows/<id>.workflow.json` (git-versioned). The UI
  canvas reads and writes this file through the API (validated with Zod). Every run records the workflow file's
  content hash, so results can be compared between versions.
- **Node**: one step. Has a `type`, a `label`, a canvas `position`, and a `config` validated by the type's schema.
  Each node ends with an **output port** (e.g. `next`, `approved`, `rejected`, `pass`, `fail`) that decides which
  edge to follow.
- **Edge**: `source` node + `port` → `target` node. An edge may carry `maxLoops` (e.g. review `fail` → implement, at
  most 2 times; after that the run stops at a human gate).
- **Skill**: a `SKILL.md` file (same format as Claude Code skills) referenced by path, e.g. `skills/analyze-requirements/SKILL.md`.
  Skills are editable in the UI and versioned by content hash on each node run.
- **Artifact**: a versioned Markdown document produced by a node (analysis, spec, test report, review, ticket doc,
  Jira comment draft). Stored in the DB (all versions, author `ai` or `user`) and mirrored into the ticket's worktree.
  A human gate can edit it; the next nodes read the approved version.
- **Run**: one execution of a workflow for one task (one active run per task, as today). Single "token": exactly one
  current node at a time (no parallelism in P1).

## Node types (P1)

| Type | What it does | Ports | Key config |
|---|---|---|---|
| `trigger.jira` | Start: the issue (description, comments, attachments) becomes the run's input | `next` | JQL filter, auto-start on new issue (on/off) |
| `ai.step` | `claude -p` with a skill + prompt template; writes an artifact. Read-only tools by default | `next` | skill, prompt template, input artifacts, output artifact name, model, budget, allowed tools |
| `human.gate` | Waits for you: approve / edit then approve / reject / send feedback and re-run the previous node | `approved`, `rejected` | which artifacts to show, which fields to choose (e.g. executor), required note |
| `agent.run` | Claude Code headless in the ticket worktree (branch `ot/<KEY>` from `origin/develop`), follows the approved spec; commits locally | `done`, `failed` | skill, permission mode, allowed tools, budget, timeout |
| `check.command` | Runs commands in the worktree, records pass/fail and output | `pass`, `fail` | commands (default for TC/SHOP: `composer test`, `vendor/bin/pint --test`), timeout |
| `ai.review` | The same agent reviews the diff against the spec with review skills; writes a review artifact with a verdict | `pass`, `fail` | skills, rubric, verdict rule |
| `doc.write` | Writes the ticket document into the repo (e.g. `docs/<KEY>-<slug>.md`) and commits it on the ticket branch | `next` | skill, path pattern, commit message pattern |
| `jira.comment` | Drafts a comment with the Jira-comment skill; posts only after your confirmation in the UI | `posted`, `skipped` | skill, tone/template |
| `git.pr` | Pushes the branch and opens a Bitbucket PR, only after your review + confirmation | `opened`, `skipped` | target branch (default `develop`), title/body template, needs Bitbucket app password |
| `evaluate` | Your rubric score (1–5 per criterion) + note; closes the run and stores metrics | `end` | rubric criteria |

Writes outside the worktree (`jira.comment`, `git.pr`) always need an explicit click with the exact content shown,
whatever the workflow says. Agents never push or merge by themselves (current `ALWAYS_DENIED` list stays).

## Default workflow (the 6 stages)

```
trigger.jira
  → ai.step "Analyze requirements"   (skill analyze-requirements → analysis.md)
  → human.gate "Review analysis"      (edit / answer open questions / approve)
  → ai.step "Propose + write spec"    (skill write-spec → spec.md: options, chosen approach, files, acceptance criteria)
  → human.gate "Approve spec"
  → agent.run "Implement"             (skill implement-from-spec)
  → check.command "Tests + lint"      (composer test, pint --test)       fail → agent.run (max 2)
  → ai.review "Review vs spec"        (skills code-review, project-conventions) fail → agent.run (max 2)
  → human.gate "Review result"        (diff, checks, review; approve / send back)
  → doc.write "Ticket document"       (skill ticket-doc → docs/<KEY>-<slug>.md, committed)
  → jira.comment "Comment on Jira"    (skill jira-comment, confirm)
  → git.pr "Open PR"                  (confirm)
  → evaluate "Score + metrics"
```

A node can be marked **skip when** a condition holds (e.g. `classification.type == "question"` skips implement/checks),
so one workflow covers questions too until separate workflows exist.

## What is tracked (for optimisation)

Per node run: start/end, waiting time for you, attempt and loop count, model, tokens and cost, skill + workflow hashes,
input/output artifact versions, how much you changed the AI's artifact at a gate (diff size), check results, review
verdict. Per run: total time, your rubric score, final outcome. A Metrics page compares these by node, skill version
and workflow version.

## Data model (new tables)

- `workflow_runs` (replaces `pipeline_runs` for new runs): task, workflow id + hash, current node id, status, worktree, branch.
- `node_runs`: run, node id, type, attempt, status, port taken, started/ended, waiting_ms, cost, tokens, skill hash, error.
- `artifacts`: run, name, version, author (ai/user), content, node_run, created_at.
- `run_events`: audit trail (same idea as `pipeline_events`).
- `evaluations`: run, rubric scores, note.

The current pipeline's tables and Inbox stay until the new engine reaches parity, then old runs are read-only.

## UI

- **Workflow editor** (`/workflows/:id`): canvas with React Flow (`@xyflow/react`): node palette on the left, canvas,
  config panel on the right (form generated from each node type's Zod schema). Validate (one trigger, reachable end,
  ports connected), Save (writes the file), "Dry run on issue…".
- **Run view** (`/runs/:id`, replaces the Inbox detail): the same graph read-only with node states (done, running,
  waiting for you, failed, skipped); click a node for its artifact (Markdown editor at gates), logs, cost, and actions.
  A list page groups runs by "waiting for you" / running / failed / done.
- **Skills** (`/skills`): list, edit, version history, "try this skill on issue X".
- **Metrics** (P4).

## Plan

- **P1a**: engine (node registry, executor on pg-boss, artifacts, gates, loops), node types `trigger.jira`, `ai.step`,
  `human.gate`, `agent.run`, `check.command`, `ai.review`, `evaluate`; default workflow as a file; Run view (read-only
  graph + node panel). Existing classify/playbook code is reused inside `ai.step` / `agent.run`.
- **P1b**: Workflow editor canvas + Skills page.
- **P2**: `doc.write`, `jira.comment` (with the Jira-comment skill), `git.pr` (Bitbucket).
- **P3**: skip conditions, per-type workflows. **P4**: Metrics page and version comparison.

## Open questions

1. Ticket docs: `docs/<KEY>-<slug>.md` (current convention in both repos) or a folder such as `docs/tickets/`? Committed on
   the ticket branch (proposed) or kept uncommitted?
2. PRs go to Bitbucket (acme): OK to add a Bitbucket app password to `.env` when we reach `git.pr`?
