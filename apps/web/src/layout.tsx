import { useQuery } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import type { PipelineList, WorkflowRunList } from '@tesserax/contracts';
import { SidebarNav } from '@/components/sidebar-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { StatusPill, type Tone } from '@/components/ui/status-pill';
import { api } from '@/lib/api';
import { ProjectDot, ProjectProvider, useProjectScope } from '@/lib/project-context';
import { cn } from '@/lib/utils';

const COLLAPSED_KEY = 'tesserax:sidebar-collapsed';
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Live numbers for the shell, from lists the pages already use (counts do not depend on the status filter). */
function useShellCounts() {
  const { scopeParam } = useProjectScope();
  const runs = useQuery({
    queryKey: ['wf', 'runs', 'shell', scopeParam],
    queryFn: () => api<WorkflowRunList>(`/api/workflow-runs?status=waiting${scopeParam ? `&${scopeParam}` : ''}`),
    refetchInterval: 10_000,
  });
  const pipeline = useQuery({ queryKey: ['pipeline', 'shell'], queryFn: () => api<PipelineList>('/api/pipeline/runs?group=decide'), refetchInterval: 10_000 });
  const rc = runs.data?.counts ?? {};
  const pc = pipeline.data?.counts ?? {};
  const waiting = rc.waiting ?? 0;
  return {
    waiting,
    counters: {
      inbox: { n: (pc.awaiting_decision ?? 0) + (pc.awaiting_verify ?? 0), tone: 'warning' as Tone },
      runs: { n: waiting + (rc.running ?? 0) + (rc.failed ?? 0), tone: (rc.failed ? 'destructive' : 'neutral') as Tone },
    },
  };
}

function ProjectPicker() {
  const { projects, selected, setSelected, current } = useProjectScope();
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ProjectDot color={current?.color ?? '#94a3b8'} name={current?.name ?? 'All projects'} />
      <Select className="h-7 w-40 min-w-0 text-xs" value={selected} onChange={e => setSelected(e.target.value)} title="Show one project, or all of them" aria-label="Project">
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const { waiting, counters } = useShellCounts();
  const toggle = () => {
    setCollapsed(c => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      } catch {
        /* private mode */
      }
      return !c;
    });
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 text-sidebar-foreground">
        <Link to="/" className="flex items-center gap-2 px-1 text-sm font-semibold tracking-tight">
          <span className="size-4 rounded bg-primary" aria-hidden />
          <span className="hidden sm:inline">Tesserax</span>
        </Link>
        <ProjectPicker />
        <div className="ml-auto flex items-center gap-2">
          {waiting > 0 && (
            <Link to="/runs" search={{ status: 'waiting' } as never} title="Runs waiting for your review">
              <StatusPill tone="warning" className="h-7 px-2.5 hover:bg-warning/20">{waiting} waiting for you</StatusPill>
            </Link>
          )}
          <ThemeToggle />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Main"
          className={cn(
            'flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-sidebar-border bg-sidebar px-2 py-1.5 text-sidebar-foreground',
            'md:flex-col md:items-stretch md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:py-2',
            collapsed ? 'md:w-14' : 'md:w-52',
          )}
        >
          <SidebarNav collapsed={collapsed} counters={counters} />
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto hidden text-muted-foreground md:mt-auto md:ml-0 md:flex md:self-start"
            onClick={toggle}
            title={collapsed ? 'Expand the sidebar' : 'Collapse to icons'}
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </nav>
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
