# Workflows

Each ticket runs through a **workflow**: a graph of nodes stored in `workflows/<id>.workflow.json`. Design notes are in [spec 0001](specs/0001-workflow-engine.md); how projects choose workflows is in [spec 0002](specs/0002-projects.md).

The default workflow:

```
Ticket → Classify → Analyze (AI) → you review → Options + spec (AI) → you approve → Implement (agent, worktree tx/<KEY>)
  → Tests + lint (fail → implement, max 2) → AI review vs spec (fail → implement, max 2) → you review the result → Score
```

## Starting and following a run

- **Start**: "Start workflow" on the Tasks page, or automatically for new Jira issues (`AUTO_START=workflow`, the default; `off` disables it). On the Tasks page you can pick a workflow before clicking "Start workflow".
- **Runs page** (`/runs`): runs waiting for you, running, failed, done. A run's page shows the graph with each node's state. Click a node for its documents (every version, AI or yours), its attempts, cost and errors.
- **New task** (Tasks page): local tasks that live only in Tesserax. Pick the repository so workflows know where to work; edit the status or delete them later. Jira tasks stay read-only. The Jira comment step is skipped for local tasks.

## Gates, score and loops

- **Gates**: edit the document (your version is what later steps use), approve, send it back with feedback (the AI step re-runs with your feedback), or reject.
- **Score**: rate the result per criterion (1–5) with a note. It is stored with the run's workflow and skill versions for later comparison.
- **Loops** have limits (`maxLoops`) and a fallback (`onLimit`), so a failing test does not loop forever.

## Node types

| Type | What it does |
|---|---|
| `ai.step` | Read-only `claude -p` with a skill; produces a document |
| `agent.run` | An agent implements in the worktree and commits locally; never pushes. See [agents](agents.md) |
| `check.command` | Shell commands in the worktree, such as `composer test` or `vendor/bin/pint --test` |
| `ai.review` | The agent reviews the diff against the spec and ends with `VERDICT: PASS/FAIL` |
| `human.gate` | Waits for you |
| `evaluate` | Your score for the run |
| `doc.write` | Writes a detailed ticket document (skill `ticket-doc`) to `docs/<KEY>-<slug>.md` in the repo and commits only that file on the ticket branch |
| `jira.comment` | The AI drafts a comment (skill `jira-comment` for tone and structure). You edit it, tick the confirmation and click **Post comment**, or **Skip**. Only the comment is written; status and fields are untouched |
| `git.pr` | The AI drafts a title and description (skill `pr-description`). The panel shows the commits to push and anything uncommitted. After you confirm, the branch is pushed (`git push --set-upstream`, never `--force`, with your own git credentials) and a Bitbucket PR is opened into the base branch (or the one you choose). If a PR is already open for the branch, its link is returned. Nothing is merged. Not in the default workflow; add it in the editor when you want it |
| classify | Labels the ticket bug / feature / chore / research / question (Claude CLI, rules as a fallback) and stores it on the run |

## Skip rules and routing

- **Skip rules**: any node can have "skip this node when …" conditions (AI type, Jira type, project, priority, status, labels, components) and a port to continue through. In the default workflow, question and research tickets skip implement, tests, AI review and the result review. Skipped nodes are shown dashed on the run graph.
- **Routing**: rules on the Workflows page, saved to `workflows/routing.json`, decide which workflow a ticket starts, for example "project is COL → workflow col". The first match wins; otherwise the default is used. Projects can have their own routing ([spec 0002](specs/0002-projects.md)).

## Editor

The Workflows page (`/workflows`) is a canvas built on React Flow.

- A searchable node palette grouped by kind (drag onto the canvas or click). Node cards show an icon, the skill and coloured ports.
- **"+" on a connection** inserts a node in between. **Dragging a port to empty space** (or right-clicking the canvas) opens a node menu at that spot.
- A settings drawer on the right, with a form generated from the node type: skill, prompt with placeholder hints, inputs and output, tools, model, budget, commands, skip rules.
- Click a connection to set a loop limit and where to go when it is reached.
- **Tidy up** arranges the graph (ELK layered layout; long chains wrap into rows).
- Problems (unreachable node, port connected twice, missing prompt…) are shown live and block saving.

| Shortcut | Action |
|---|---|
| Cmd+Z / Shift+Cmd+Z | Undo / redo |
| Cmd+C / Cmd+V | Copy / paste |
| Cmd+D | Duplicate |
| Del | Delete |
| Cmd+S | Save |

Saving writes `workflows/<id>.workflow.json`; runs already in progress keep the version they started with. "New workflow" copies the default.

## Skills page

Your skills live in `skills/<name>/SKILL.md` (gitignored, created from `examples/skills/` on first `pnpm dev`). The examples are analyze-requirements, write-spec, implement-from-spec, code-review, project-conventions, jira-comment, pr-description, pr-review and ticket-doc. Edit them to tune each stage.

The Skills page (`/skills`) edits `SKILL.md` files, creates new ones, and lets you **try a skill on a ticket** (read-only, in the project's repo) before a workflow uses it.

## Metrics

The Metrics page (`/metrics`) shows, per workflow version, runs, done rate, your average score per criterion, cost and time. Per skill version it shows how often its output was accepted as-is, edited, or sent back at the next review, the cost per use, and whether it is the current version. Per node it shows runs, skips, retries, failures, gate outcomes, your time at gates, and pass/fail for checks and reviews. Your evaluation notes are there too. Use it to see whether a skill or workflow change helped.

## Reviewing someone else's pull request

Create a task of type **Code review** with the member's branch (and optionally the target branch and the PR link). The routing rule starts the `pr-review` workflow:

1. The branch is checked out read-only in its own worktree (`review__<KEY>`). Nothing is pushed.
2. Tests run on it.
3. The AI reviews the diff against the target branch (skills `pr-review` and `project-conventions`).
4. You edit and approve the review.
5. **Comment on the PR** posts it on Bitbucket after you confirm. This needs `BITBUCKET_API_TOKEN` with `read:pullrequest` and `write:pullrequest` ([integrations](integrations.md#bitbucket)). Without it, skip the step and copy the review yourself.
