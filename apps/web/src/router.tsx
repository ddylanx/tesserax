import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Layout } from './layout';
import { AgentsPage } from './routes/agents';
import { McpPage } from './routes/mcp';
import { MetricsPage } from './routes/metrics';
import { RunDetailPage } from './routes/run-detail';
import { RunsPage } from './routes/runs';
import { SkillsPage } from './routes/skills';
import { WorkflowEditorPage } from './routes/workflow-editor';
import { WorkflowsPage } from './routes/workflows';
import { SystemPage } from './routes/system';
import { TasksPage } from './routes/tasks';
import { ReposPage } from './routes/repos';
import { ProjectsPage } from './routes/projects';
import { ProjectDetailPage } from './routes/project-detail';

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/runs' }); } });
const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs',
  validateSearch: (s: Record<string, unknown>): { status?: string } => ({ status: typeof s.status === 'string' ? s.status : undefined }),
  component: RunsPage,
});
const runDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs/$runId', component: RunDetailPage });
const workflowsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/workflows', component: WorkflowsPage });
const workflowEditorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/workflows/$workflowId', component: WorkflowEditorPage });
const reposRoute = createRoute({ getParentRoute: () => rootRoute, path: '/repos', component: ReposPage });
const skillsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/skills', component: SkillsPage });
const metricsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/metrics', component: MetricsPage });
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: TasksPage });
const agentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: AgentsPage });
const mcpRoute = createRoute({ getParentRoute: () => rootRoute, path: '/mcp', component: McpPage });
const projectsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsPage });
const projectDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$slug', component: ProjectDetailPage });
const systemRoute = createRoute({ getParentRoute: () => rootRoute, path: '/system', component: SystemPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, projectsRoute, projectDetailRoute, runsRoute, runDetailRoute, workflowsRoute, workflowEditorRoute, skillsRoute, metricsRoute, tasksRoute, reposRoute, agentsRoute, mcpRoute, systemRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
