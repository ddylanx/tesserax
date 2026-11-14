import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Layout } from './layout';
import { AgentsPage } from './routes/agents';
import { ContextPage, type ContextView } from './routes/context';
import { InboxPage } from './routes/inbox';
import { McpPage } from './routes/mcp';
import { MetricsPage } from './routes/metrics';
import { RunDetailPage } from './routes/run-detail';
import { RunsPage } from './routes/runs';
import { SkillsPage } from './routes/skills';
import { TeamPage } from './routes/team';
import { WorkflowEditorPage } from './routes/workflow-editor';
import { WorkflowsPage } from './routes/workflows';
import { SystemPage } from './routes/system';
import { TasksPage } from './routes/tasks';
import { ReposPage } from './routes/repos';
import { ProjectsPage } from './routes/projects';
import { ProjectDetailPage } from './routes/project-detail';

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/inbox' }); } });
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
  validateSearch: (s: Record<string, unknown>): { status?: string; workflow?: string; q?: string; onboarding?: string } => ({
    status: typeof s.status === 'string' ? s.status : undefined,
    workflow: typeof s.workflow === 'string' && s.workflow ? s.workflow : undefined,
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    onboarding: typeof s.onboarding === 'string' ? s.onboarding : undefined,
  }),
  component: RunsPage,
});
const runDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs/$runId', component: RunDetailPage });
const workflowsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/workflows', component: WorkflowsPage });
const workflowEditorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/workflows/$workflowId', component: WorkflowEditorPage });
const reposRoute = createRoute({ getParentRoute: () => rootRoute, path: '/repos', component: ReposPage });
const skillsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/skills', component: SkillsPage });
const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/team',
  validateSearch: (s: Record<string, unknown>): { view?: 'live' } => ({ view: s.view === 'live' ? 'live' : undefined }),
  component: TeamPage,
});
const contextRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/context',
  validateSearch: (s: Record<string, unknown>): { view?: ContextView; role?: string } => ({
    view: s.view === 'matrix' || s.view === 'improve' ? s.view : undefined,
    role: typeof s.role === 'string' && s.role ? s.role : undefined,
  }),
  component: ContextPage,
});
const metricsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/metrics', component: MetricsPage });
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: TasksPage });
const agentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: AgentsPage });
const mcpRoute = createRoute({ getParentRoute: () => rootRoute, path: '/mcp', component: McpPage });
const projectsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsPage });
const projectDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$slug', component: ProjectDetailPage });
const systemRoute = createRoute({ getParentRoute: () => rootRoute, path: '/system', component: SystemPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, projectsRoute, projectDetailRoute, runsRoute, runDetailRoute, workflowsRoute, workflowEditorRoute, skillsRoute, teamRoute, contextRoute, metricsRoute, inboxRoute, tasksRoute, reposRoute, agentsRoute, mcpRoute, systemRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
