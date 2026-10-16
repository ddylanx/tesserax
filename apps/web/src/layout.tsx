import { Link, Outlet } from '@tanstack/react-router';
import { BarChart3, Bot, Boxes, FolderGit2, Layers, ListChecks, Network, Server, Sparkles, Workflow } from 'lucide-react';
import { Select } from '@/components/ui/input';
import { ProjectDot, ProjectProvider, useProjectScope } from '@/lib/project-context';

const nav = [
  { to: '/projects', label: 'Projects', icon: Layers },
  { to: '/runs', label: 'Runs', icon: Workflow },
  { to: '/workflows', label: 'Workflows', icon: Network },
  { to: '/skills', label: 'Skills', icon: Sparkles },
  { to: '/metrics', label: 'Metrics', icon: BarChart3 },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/repos', label: 'Repos', icon: FolderGit2 },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/mcp', label: 'MCP', icon: Boxes },
  { to: '/system', label: 'System', icon: Server },
] as const;

function ProjectPicker() {
  const { projects, selected, setSelected, current } = useProjectScope();
  return (
    <div className="flex items-center gap-1.5 px-1 md:mb-3">
      <ProjectDot color={current?.color ?? '#94a3b8'} name={current?.name ?? 'All projects'} />
      <Select className="h-7 min-w-0 flex-1 text-xs" value={selected} onChange={e => setSelected(e.target.value)} title="Show one project, or all of them">
        <option value="">All projects</option>
        {projects.map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
      </Select>
    </div>
  );
}

export function Layout() {
  return (
    <ProjectProvider>
      <Shell />
    </ProjectProvider>
  );
}

function Shell() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 items-center gap-1 border-b bg-card px-3 py-2 md:w-52 md:flex-col md:items-stretch md:border-r md:border-b-0 md:py-4">
        <div className="mr-3 px-2 text-sm font-semibold md:mr-0 md:mb-2">Tesserax</div>
        <ProjectPicker />
        {nav.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            activeProps={{ className: 'bg-accent !text-foreground font-medium' }}
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        ))}
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
