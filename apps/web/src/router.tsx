import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Layout } from './layout';
import { AgentsPage } from './routes/agents';
import { InboxPage } from './routes/inbox';
import { McpPage } from './routes/mcp';
import { MetricsPage } from './routes/metrics';
import { RunDetailPage } from './routes/run-detail';
import { RunsPage } from './routes/runs';
import { SkillsPage } from './routes/skills';
import { WorkflowEditorPage } from './routes/workflow-editor';
import { WorkflowsPage } from './routes/workflows';
import { SystemPage } from './routes/system';
import { TasksPage } from './routes/tasks';

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/runs' }); } });
const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  validateSearch: (s: Record<string, unknown>): { run?: string; group?: string } => ({
    run: typeof s.run === 'string' ? s.run : undefined,
    group: typeof s.group === 'string' ? s.group : undefined,
  }),
  component: InboxPage,
});
const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs',
  validateSearch: (s: Record<string, unknown>): { status?: string } => ({ status: typeof s.status === 'string' ? s.status : undefined }),
  component: RunsPage,
});
const runDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs/$runId', component: RunDetailPage });
const workflowsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/workflows', component: WorkflowsPage });
const workflowEditorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/workflows/$workflowId', component: WorkflowEditorPage });
const skillsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/skills', component: SkillsPage });
const metricsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/metrics', component: MetricsPage });
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: TasksPage });
const agentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: AgentsPage });
const mcpRoute = createRoute({ getParentRoute: () => rootRoute, path: '/mcp', component: McpPage });
const systemRoute = createRoute({ getParentRoute: () => rootRoute, path: '/system', component: SystemPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, runsRoute, runDetailRoute, workflowsRoute, workflowEditorRoute, skillsRoute, metricsRoute, inboxRoute, tasksRoute, agentsRoute, mcpRoute, systemRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
