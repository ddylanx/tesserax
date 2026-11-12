import { z } from 'zod';
import { agentSessionListSchema, agentEventSchema, claudeHookPayloadSchema } from './agents';
import { mcpListSchema, mcpServerPolicyDtoSchema, mcpPolicySchema, mcpToolCacheSchema, updateMcpPolicySchema } from './mcp';
import { decisionSchema, feedbackStatsSchema, pipelineListSchema, pipelineRunDetailSchema, playbookSchema, repoMapSchema, runDiffSchema, verifySchema } from './pipeline';
import { moveTaskSchema, projectCardSchema, projectSchema, saveProjectSchema } from './projects';
import { demoRepoResponseSchema, repoRegistrySchema, setTaskWorkplaceSchema } from './repos';
import { environmentStatusSchema, healthSchema, systemInfoSchema } from './system';
import { createLocalTaskSchema, taskDetailSchema, taskListSchema, taskQuerySchema, updateLocalTaskSchema, updateTaskStatusSchema } from './tasks';
import {
  confirmActionSchema,
  evaluateActionSchema,
  executorActionSchema,
  gateActionSchema,
  handoffActionSchema,
  nodeAgentActionSchema,
  nodeModelActionSchema,
  prCommentActionSchema,
  rerunNodeActionSchema,
  routingSchema,
  runFromActionSchema,
  trySkillSchema,
  workflowRunDetailSchema,
  workflowRunListSchema,
  workflowSchema,
} from './workflow';

/**
 * Every HTTP route of the API, for the OpenAPI document (`GET /api/openapi.json`) that tools and AI assistants read.
 * A test in apps/api checks this list against the controllers, so a new endpoint must be added here.
 *
 * `outward` marks routes that act outside Tesserax (post to Jira, push, open or comment on a PR): only the person
 * triggers them, from the web UI. `decision` marks the person's review decisions.
 */
export interface ApiRoute {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Path under /api (except /health), with {params}. */
  path: string;
  tag: string;
  summary: string;
  query?: z.ZodObject;
  body?: z.ZodType;
  response?: z.ZodType;
  outward?: true;
  decision?: true;
}

const ok = z.object({ ok: z.literal(true) });
const workflowIdBody = z.object({ workflowId: z.string().optional() });
const nodeLog = z.object({ text: z.string(), next: z.number(), exists: z.boolean(), live: z.boolean() });
const runStarted = z.object({ runId: z.string(), created: z.boolean(), workflowId: z.string() });

export const API_ROUTES: ApiRoute[] = [
  // system
  { method: 'get', path: '/health', tag: 'system', summary: 'Liveness: API and database up.', response: healthSchema },
  { method: 'get', path: '/system', tag: 'system', summary: 'Versions, schedules and agent CLIs.', response: systemInfoSchema },
  { method: 'get', path: '/system/environment', tag: 'system', summary: 'What is configured in .env (never the values).', response: environmentStatusSchema },
  { method: 'get', path: '/openapi.json', tag: 'system', summary: 'This document.' },

  // projects
  { method: 'get', path: '/projects', tag: 'projects', summary: 'Projects with task counts.', response: z.object({ projects: z.array(projectCardSchema) }) },
  { method: 'get', path: '/projects/{slug}', tag: 'projects', summary: 'One project with its settings.', response: projectSchema },
  { method: 'post', path: '/projects', tag: 'projects', summary: 'Create a project.', body: saveProjectSchema, response: projectSchema },
  { method: 'put', path: '/projects/{slug}', tag: 'projects', summary: 'Save a project.', body: saveProjectSchema, response: projectSchema },
  { method: 'delete', path: '/projects/{slug}', tag: 'projects', summary: 'Delete a project (its tasks go back to the rules).' },

  // tasks
  { method: 'get', path: '/tasks', tag: 'tasks', summary: 'Tasks, filtered and optionally paged.', query: taskQuerySchema, response: taskListSchema },
  { method: 'get', path: '/tasks/{id}', tag: 'tasks', summary: 'One task with description, comments and attachments.', response: taskDetailSchema },
  { method: 'post', path: '/tasks', tag: 'tasks', summary: 'Create a local task.', body: createLocalTaskSchema, response: taskDetailSchema },
  { method: 'patch', path: '/tasks/{id}', tag: 'tasks', summary: 'Edit a local task.', body: updateLocalTaskSchema, response: taskDetailSchema },
  { method: 'patch', path: '/tasks/{id}/status', tag: 'tasks', summary: 'Set the status of a local task.', body: updateTaskStatusSchema, response: taskDetailSchema },
  { method: 'patch', path: '/tasks/{id}/workplace', tag: 'tasks', summary: 'Pick the workplace a task runs in.', body: setTaskWorkplaceSchema, response: taskDetailSchema },
  { method: 'patch', path: '/tasks/{id}/project', tag: 'tasks', summary: 'Move a task to a project by hand (null: back to the rules).', body: moveTaskSchema, response: taskDetailSchema },
  { method: 'delete', path: '/tasks/{id}', tag: 'tasks', summary: 'Delete a local task.', response: ok },
  { method: 'post', path: '/tasks/sync', tag: 'tasks', summary: 'Sync task sources now.' },

  // workflows and runs
  { method: 'get', path: '/workflows', tag: 'workflows', summary: 'Workflow files (id, name, hash, problems).' },
  { method: 'get', path: '/workflows/{id}', tag: 'workflows', summary: 'One workflow definition.', response: workflowSchema },
  { method: 'post', path: '/workflows', tag: 'workflows', summary: 'Create a workflow (optionally a copy).', body: z.object({ id: z.string().optional(), name: z.string().optional(), copyFrom: z.string().optional() }) },
  { method: 'put', path: '/workflows/{id}', tag: 'workflows', summary: 'Save a workflow.', body: workflowSchema },
  { method: 'get', path: '/node-types', tag: 'workflows', summary: 'Node types, their ports and config schemas.' },
  { method: 'get', path: '/workflow-routing', tag: 'workflows', summary: 'Which workflow a task starts (per project).', query: z.object({ project: z.string().optional() }), response: routingSchema },
  { method: 'put', path: '/workflow-routing', tag: 'workflows', summary: 'Save the routing of a project.', query: z.object({ project: z.string().optional() }), body: routingSchema },
  { method: 'get', path: '/agent-executors', tag: 'workflows', summary: 'Agent engines (Claude Code, Gemini, Antigravity) and whether they are installed.' },
  { method: 'post', path: '/skills/{name}/try', tag: 'workflows', summary: 'Try a skill on sample input.', body: trySkillSchema },
  { method: 'get', path: '/metrics', tag: 'workflows', summary: 'Run outcomes, cost and time per workflow version.', query: z.object({ days: z.string().optional(), workflowId: z.string().optional() }) },

  { method: 'get', path: '/workflow-runs', tag: 'runs', summary: 'Runs, newest activity first (status is comma-separated).', query: z.object({ status: z.string().optional(), project: z.string().optional(), workflow: z.string().optional(), q: z.string().optional() }), response: workflowRunListSchema },
  { method: 'get', path: '/workflow-runs/{id}', tag: 'runs', summary: 'One run with steps, documents and events.', response: workflowRunDetailSchema },
  { method: 'get', path: '/workflow-runs/{id}/node-runs/{nodeRunId}/log', tag: 'runs', summary: 'A step\'s agent log; pass the previous `next` as `from`.', query: z.object({ from: z.string().optional() }), response: nodeLog },
  { method: 'get', path: '/workflow-runs/{id}/diff', tag: 'runs', summary: 'The run\'s code change against its base.', response: runDiffSchema },
  { method: 'post', path: '/tasks/{taskId}/workflow-runs', tag: 'runs', summary: 'Start a run for a task (returns the active one if any).', body: workflowIdBody, response: runStarted },
  { method: 'post', path: '/workflow-runs/{id}/workflow', tag: 'runs', summary: 'Switch a run that has not passed its first step to another workflow.', body: workflowIdBody },
  { method: 'post', path: '/workflow-runs/{id}/gate', tag: 'runs', summary: 'The person\'s decision at a review gate.', body: gateActionSchema, response: ok, decision: true },
  { method: 'post', path: '/workflow-runs/{id}/confirm', tag: 'runs', summary: 'Post the Jira comment or push + open the PR, with the exact text shown.', body: confirmActionSchema, outward: true },
  { method: 'post', path: '/workflow-runs/{id}/pr-comment', tag: 'runs', summary: 'Post the approved review on the PR.', body: prCommentActionSchema, outward: true },
  { method: 'post', path: '/workflow-runs/{id}/evaluate', tag: 'runs', summary: 'The person\'s scores for a finished run.', body: evaluateActionSchema, response: ok, decision: true },
  { method: 'post', path: '/workflow-runs/{id}/retry', tag: 'runs', summary: 'Retry the failed step.', response: ok },
  { method: 'post', path: '/workflow-runs/{id}/rerun', tag: 'runs', summary: 'Run one failed step again.', body: rerunNodeActionSchema, response: ok },
  { method: 'post', path: '/workflow-runs/{id}/run-from', tag: 'runs', summary: 'Pick the run up again at a step, keeping its documents.', body: runFromActionSchema, response: ok },
  { method: 'post', path: '/workflow-runs/{id}/cancel', tag: 'runs', summary: 'Cancel the run; a running agent is stopped.', response: ok },
  { method: 'post', path: '/workflow-runs/{id}/executor', tag: 'runs', summary: 'Pick the agent engine of a step.', body: executorActionSchema },
  { method: 'post', path: '/workflow-runs/{id}/agent', tag: 'runs', summary: 'Pick the agent of a step.', body: nodeAgentActionSchema },
  { method: 'post', path: '/workflow-runs/{id}/model', tag: 'runs', summary: 'Pick the model of a step.', body: nodeModelActionSchema },
  { method: 'post', path: '/workflow-runs/{id}/handoff/reopen', tag: 'runs', summary: 'Reopen a step handed to the person.' },
  { method: 'post', path: '/workflow-runs/{id}/handoff/finish', tag: 'runs', summary: 'The person finished a handed-off step.', body: handoffActionSchema, decision: true },

  // skills
  { method: 'get', path: '/skills', tag: 'skills', summary: 'The repo\'s own skills.' },
  { method: 'get', path: '/skills/{name}', tag: 'skills', summary: 'One skill.' },
  { method: 'put', path: '/skills/{name}', tag: 'skills', summary: 'Save a skill.' },
  { method: 'post', path: '/skills', tag: 'skills', summary: 'Create a skill.', body: z.object({ name: z.string().optional(), description: z.string().optional() }) },
  { method: 'get', path: '/skill-packages', tag: 'skills', summary: 'Installed skill packages.' },
  { method: 'get', path: '/skill-packages/skills', tag: 'skills', summary: 'Skills from installed packages.' },
  { method: 'get', path: '/skill-packages/{id}/skills/{skill}', tag: 'skills', summary: 'One package skill.' },
  { method: 'post', path: '/skill-packages', tag: 'skills', summary: 'Install a skill package from a git repo.' },
  { method: 'post', path: '/skill-packages/{id}/update', tag: 'skills', summary: 'Update a skill package.' },
  { method: 'patch', path: '/skill-packages/{id}', tag: 'skills', summary: 'Edit a skill package.' },
  { method: 'delete', path: '/skill-packages/{id}', tag: 'skills', summary: 'Remove a skill package.', query: z.object({ force: z.string().optional() }) },

  // repos
  { method: 'get', path: '/repos', tag: 'repos', summary: 'Repositories and workplaces.', response: repoRegistrySchema },
  { method: 'post', path: '/repos/demo', tag: 'repos', summary: 'Create the demo repository.', response: demoRepoResponseSchema },
  { method: 'post', path: '/repos/inspect', tag: 'repos', summary: 'Inspect a local folder (git origin, branch).', body: z.object({ path: z.string().optional() }) },
  { method: 'put', path: '/repos/repositories/{id}', tag: 'repos', summary: 'Save a repository.' },
  { method: 'delete', path: '/repos/repositories/{id}', tag: 'repos', summary: 'Delete a repository.' },
  { method: 'put', path: '/repos/workplaces/{id}', tag: 'repos', summary: 'Save a workplace.' },
  { method: 'delete', path: '/repos/workplaces/{id}', tag: 'repos', summary: 'Delete a workplace.' },

  // agents and MCP
  { method: 'post', path: '/agents/events', tag: 'agents', summary: 'Claude Code hook events (sent by the installed hooks).', body: claudeHookPayloadSchema },
  { method: 'get', path: '/agents/sessions', tag: 'agents', summary: 'Agent sessions.', query: z.object({ scope: z.string().optional(), project: z.string().optional() }), response: agentSessionListSchema },
  { method: 'get', path: '/agents/sessions/{id}/events', tag: 'agents', summary: 'Events of an agent session.', response: z.array(agentEventSchema) },
  { method: 'get', path: '/mcp/servers', tag: 'mcp', summary: 'MCP servers the agent CLIs know about.', query: z.object({ fresh: z.string().optional() }), response: mcpListSchema },
  { method: 'get', path: '/mcp/policy', tag: 'mcp', summary: 'MCP servers with their run policy.', query: z.object({ fresh: z.string().optional() }), response: z.array(mcpServerPolicyDtoSchema) },
  { method: 'put', path: '/mcp/policy/{server}', tag: 'mcp', summary: 'Set the run policy of an MCP server.', body: updateMcpPolicySchema, response: mcpPolicySchema },
  { method: 'post', path: '/mcp/servers/{server}/tools/refresh', tag: 'mcp', summary: 'Refresh the tool list of an MCP server.', response: mcpToolCacheSchema },

  // older pipeline
  { method: 'get', path: '/pipeline/runs', tag: 'pipeline', summary: 'Pipeline runs (older automation).', query: z.object({ group: z.string().optional() }), response: pipelineListSchema },
  { method: 'get', path: '/pipeline/runs/{id}', tag: 'pipeline', summary: 'One pipeline run.', response: pipelineRunDetailSchema },
  { method: 'post', path: '/pipeline/tasks/{taskId}/runs', tag: 'pipeline', summary: 'Start a pipeline run.' },
  { method: 'post', path: '/pipeline/runs/{id}/decide', tag: 'pipeline', summary: 'The person\'s decision on a pipeline run.', body: decisionSchema, decision: true },
  { method: 'post', path: '/pipeline/runs/{id}/reject', tag: 'pipeline', summary: 'Reject a pipeline run.', body: z.object({ note: z.string().optional() }), decision: true },
  { method: 'post', path: '/pipeline/runs/{id}/reclassify', tag: 'pipeline', summary: 'Classify again.' },
  { method: 'post', path: '/pipeline/runs/{id}/retry', tag: 'pipeline', summary: 'Retry the failed step.' },
  { method: 'post', path: '/pipeline/runs/{id}/rerun', tag: 'pipeline', summary: 'Run again.' },
  { method: 'post', path: '/pipeline/runs/{id}/cancel', tag: 'pipeline', summary: 'Cancel.' },
  { method: 'post', path: '/pipeline/runs/{id}/verify', tag: 'pipeline', summary: 'The person\'s verification of the result.', body: verifySchema, decision: true },
  { method: 'get', path: '/pipeline/runs/{id}/diff', tag: 'pipeline', summary: 'The run\'s code change.', response: runDiffSchema },
  { method: 'post', path: '/pipeline/runs/{id}/jira-comment', tag: 'pipeline', summary: 'Post the Jira comment.', outward: true },
  { method: 'get', path: '/pipeline/feedback', tag: 'pipeline', summary: 'Feedback statistics.', response: feedbackStatsSchema },
  { method: 'get', path: '/pipeline/playbooks', tag: 'pipeline', summary: 'Playbooks.', response: z.array(playbookSchema) },
  { method: 'get', path: '/pipeline/repos', tag: 'pipeline', summary: 'Legacy project → repo map.', response: repoMapSchema },
  { method: 'put', path: '/pipeline/repos/{project}', tag: 'pipeline', summary: 'Set a legacy repo path.', body: z.object({ path: z.string().optional() }) },
];

const json = (s: z.ZodType, io: 'input' | 'output') => z.toJSONSchema(s, { io, unrepresentable: 'any', target: 'openapi-3.0' }) as Record<string, unknown>;

/** OpenAPI 3.0 document of the API, built from the Zod contracts. */
export function buildOpenApi(opts: { serverUrl: string; version?: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of API_ROUTES) {
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    if (r.query) {
      const shape = json(r.query, 'input') as { properties?: Record<string, unknown>; required?: string[] };
      for (const [name, schema] of Object.entries(shape.properties ?? {})) params.push({ name, in: 'query', required: shape.required?.includes(name) ?? false, schema } as never);
    }
    const notes = [r.outward && 'Outward action: only the person triggers it, from the web UI.', r.decision && 'Records the person\'s decision.'].filter(Boolean);
    const full = r.path === '/health' ? r.path : `/api${r.path}`;
    paths[full] ??= {};
    paths[full][r.method] = {
      tags: [r.tag],
      summary: r.summary,
      ...(notes.length ? { description: notes.join(' ') } : {}),
      ...(r.outward ? { 'x-tesserax-outward': true } : {}),
      ...(r.decision ? { 'x-tesserax-decision': true } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: json(r.body, 'input') } } } } : {}),
      responses: { default: { description: 'Response', ...(r.response ? { content: { 'application/json': { schema: json(r.response, 'output') } } } : {}) } },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Tesserax API',
      version: opts.version ?? '0.0.0',
      description: 'Local API of Tesserax. No auth: it binds to 127.0.0.1. Routes marked x-tesserax-outward act outside Tesserax and are for the person only. See docs/ai-control.md.',
    },
    servers: [{ url: opts.serverUrl }],
    paths,
  };
}
