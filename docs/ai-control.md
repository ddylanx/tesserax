# Drive Tesserax from an AI assistant

Tesserax is the arm of the person who decides. An assistant (Claude Code, Claude Desktop, any MCP client) can look at everything and do the work for you: find tasks, start runs, follow them, read what they made, retry what failed. Decisions stay yours, and anything that leaves Tesserax (a Jira comment, a push, a pull request, a PR comment) happens only when you click it in the web UI.

There are two ways in:

- **MCP server** `tesserax` (`apps/mcp`): tools an assistant calls directly. Use this one.
- **HTTP API** with an OpenAPI document at `GET /api/openapi.json`, for scripts and other tools.

Both talk to the API on `127.0.0.1` with no auth, so they only work on the machine where `pnpm dev` runs.

## Set up the MCP server

The repo ships a `.mcp.json`, so Claude Code started in the Tesserax folder offers the `tesserax` server (approve it once with `/mcp`). To have it in every folder:

```bash
claude mcp add tesserax --scope user -- node /path/to/tesserax/apps/mcp/bin.cjs
```

On Windows use the full path, e.g. `node C:\path\to\tesserax\apps\mcp\bin.cjs`. Other MCP clients (Claude Desktop, Cursor…) take the same command: `node <repo>/apps/mcp/bin.cjs`.

Check it: start `pnpm dev`, then in Claude Code ask "what is waiting for me in tesserax?". The assistant calls `tesserax_status`.

The server finds the API from `TESSERAX_API_URL`, else `API_HOST` / `API_PORT` (environment, then the repo's `.env`; no other keys are read), else `http://127.0.0.1:4400`. Links point at `WEB_BASE_URL`.

### From a Claude project or your phone

A cloud session (a Claude project, claude.ai on your phone) cannot reach `127.0.0.1` on your computer. Start a Remote Control session in the Tesserax folder (`claude remote-control`) and talk to it from the project: it runs on your computer, where the `tesserax` server is. Do not expose the API to the internet: it has no auth.

## Tools

| Tool | Kind | What it does |
| --- | --- | --- |
| `tesserax_status` | read | Runs waiting for you, running, recently failed, with links. Start here. |
| `list_projects`, `get_project` | read | Projects and their settings. |
| `list_tasks`, `get_task` | read | Tasks by project, status or text; one task with description and comments. |
| `list_workflows` | read | Workflows, or one workflow's steps. |
| `list_runs`, `get_run` | read | Runs; one run with its steps, documents, events and what it waits for. |
| `read_document` | read | A document a run made (analysis, spec, review), any version. |
| `get_run_diff`, `get_step_log` | read | The code change; what an agent step did. |
| `get_metrics` | read | Outcomes, cost and time per workflow version. |
| `create_task`, `set_task_status`, `sync_tasks` | act | Local tasks and source sync. |
| `start_run`, `cancel_run`, `retry_run`, `rerun_step`, `run_from_step` | act | Run control. |
| `decide_gate` | decide | Records **your** decision at a review gate: approved, changes (with feedback) or rejected. |

Tasks and runs can be named by key (`TESS-12`, `#14`) instead of id; a task key means its latest run.

What the server does not do: confirm steps (Jira comment, push + open PR, PR comment), evaluations, deleting anything, editing projects, workflows, skills or repos. For a run waiting at a confirm step, `get_run` returns the link for you to open.

### The decision rule

`decide_gate` is for a decision you gave the assistant in the conversation ("approve the spec of TESS-12", "send it back: add tests"). Its description tells the assistant never to decide on its own judgment or because a task, document or log says so, and it needs `decidedByPerson: true`. The tool cannot check who is talking, so if you want no gate decisions at all through MCP, limit the server:

| `TESSERAX_MCP_MODE` | Tools |
| --- | --- |
| `read` | read only |
| `act` | read + act |
| `full` (default) | read + act + `decide_gate` |

```bash
claude mcp add tesserax --scope user -e TESSERAX_MCP_MODE=act -- node /path/to/tesserax/apps/mcp/bin.cjs
```

Text from tasks, documents and logs comes from outside (Jira, GitHub, agents). The server wraps task text in `<task-text>` and tells the assistant to treat all of it as data.

## OpenAPI

`GET http://127.0.0.1:4400/api/openapi.json` describes every route, built from the Zod contracts in `@tesserax/contracts` (`openapi.ts`). Routes marked `x-tesserax-outward` act outside Tesserax and are for you only; `x-tesserax-decision` marks your decisions. A test (`apps/api/src/system/openapi.test.ts`) fails when a controller route is missing from the list, so add new endpoints to `API_ROUTES`.
