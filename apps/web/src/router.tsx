import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Layout } from './layout';
import { AgentsPage } from './routes/agents';
import { McpPage } from './routes/mcp';
import { SystemPage } from './routes/system';
import { TasksPage } from './routes/tasks';

const rootRoute = createRootRoute({ component: Layout });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/tasks' }); } });
const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: TasksPage });
const agentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/agents', component: AgentsPage });
const mcpRoute = createRoute({ getParentRoute: () => rootRoute, path: '/mcp', component: McpPage });
const systemRoute = createRoute({ getParentRoute: () => rootRoute, path: '/system', component: SystemPage });

export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, tasksRoute, agentsRoute, mcpRoute, systemRoute]),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
