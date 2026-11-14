import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Link } from '@tanstack/react-router';
import {
  BarChart3, BookOpenText, Bot, Boxes, FolderGit2, GripVertical, Inbox, Layers, ListChecks, Network, RotateCcw, Server, Sparkles, Users, Workflow, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Count, type Tone } from '@/components/ui/status-pill';
import { loadLayout, mergeLayout, moveBy, moveGroup, moveItem, sameLayout, saveLayout, type Edge, type NavLayout } from '@/lib/nav-order';
import { cn } from '@/lib/utils';

export type Counter = 'inbox' | 'runs';
interface NavItem { to: string; label: string; icon: LucideIcon; counter?: Counter }

const ITEMS: NavItem[] = [
  { to: '/inbox', label: 'Inbox', icon: Inbox, counter: 'inbox' },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/runs', label: 'Runs', icon: Workflow, counter: 'runs' },
  { to: '/workflows', label: 'Workflows', icon: Network },
  { to: '/skills', label: 'Skills', icon: Sparkles },
  { to: '/team', label: 'Team', icon: Users },
  { to: '/context', label: 'Context', icon: BookOpenText },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/projects', label: 'Projects', icon: Layers },
  { to: '/repos', label: 'Repos', icon: FolderGit2 },
  { to: '/mcp', label: 'MCP', icon: Boxes },
  { to: '/system', label: 'System', icon: Server },
  { to: '/metrics', label: 'Metrics', icon: BarChart3 },
];
const BY_ROUTE = new Map(ITEMS.map(i => [i.to, i]));

const DEFAULT_LAYOUT: NavLayout = [
  { group: 'Work', items: ['/inbox', '/tasks', '/runs'] },
  { group: 'Build', items: ['/workflows', '/skills', '/team', '/context', '/agents'] },
  { group: 'Setup', items: ['/projects', '/repos', '/mcp', '/system'] },
  { group: 'Insights', items: ['/metrics'] },
];

/** The sidebar is a column from md up, a row below it. */
const vertical = () => window.matchMedia('(min-width: 768px)').matches;

/** Which half of the element the pointer is over, along the nav's axis. */
function edgeOf(element: Element, input: { clientX: number; clientY: number }): Edge {
  const r = element.getBoundingClientRect();
  return vertical() ? (input.clientY < r.top + r.height / 2 ? 'before' : 'after') : input.clientX < r.left + r.width / 2 ? 'before' : 'after';
}

function DropLine({ edge }: { edge: Edge }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute z-10 rounded-full bg-primary',
        'inset-y-0.5 w-0.5 md:inset-x-1 md:inset-y-auto md:h-0.5 md:w-auto',
        edge === 'before' ? '-left-0.5 md:-top-px md:left-1' : '-right-0.5 md:-bottom-px md:right-1 md:left-1',
      )}
    />
  );
}

export function SidebarNav({ collapsed, counters }: { collapsed: boolean; counters: Record<Counter, { n: number; tone: Tone }> }) {
  const [layout, setLayout] = useState(() => mergeLayout(DEFAULT_LAYOUT, loadLayout()));
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const custom = !sameLayout(layout, DEFAULT_LAYOUT);

  const update = (next: NavLayout, focus?: string) => {
    setLayout(next);
    saveLayout(sameLayout(next, DEFAULT_LAYOUT) ? null : next);
    // a move between groups remounts the link: keep keyboard focus on it
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-nav-item="${focus}"]`)?.focus());
  };

  useEffect(
    () =>
      monitorForElements({
        canMonitor: ({ source }) => source.data.type === 'nav-item' || source.data.type === 'nav-group',
        onDrop: ({ source, location }) => {
          const target = location.current.dropTargets[0]?.data;
          if (!target) return;
          const cur = layoutRef.current;
          if (source.data.type === 'nav-item') {
            const to = source.data.to as string;
            if (target.type === 'nav-item') update(moveItem(cur, to, target.group as string, target.to as string, target.edge as Edge));
            else if (target.type === 'nav-group') update(moveItem(cur, to, target.group as string, null, 'after'));
          } else if (target.type === 'nav-group') {
            update(moveGroup(cur, source.data.group as string, target.group as string, target.edge as Edge));
          }
        },
      }),
    [],
  );

  const onKey = (to: string) => (e: KeyboardEvent) => {
    if (!e.altKey) return;
    const delta = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    update(moveBy(layoutRef.current, to, delta), to);
  };

  return (
    <>
      {layout.map(g => (
        <NavGroup key={g.group} group={g.group} collapsed={collapsed}>
          {g.items.map(to => {
            const item = BY_ROUTE.get(to);
            return item ? <NavLink key={to} item={item} group={g.group} collapsed={collapsed} counter={item.counter ? counters[item.counter] : undefined} onKeyDown={onKey(to)} /> : null;
          })}
        </NavGroup>
      ))}
      {custom && (
        <button
          type="button"
          onClick={() => update(DEFAULT_LAYOUT)}
          title="Reset menu order"
          className={cn(
            'mt-2 hidden items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-foreground md:flex',
            collapsed && 'md:justify-center',
          )}
        >
          <RotateCcw className="size-3.5 shrink-0" />
          <span className={cn(collapsed && 'md:hidden')}>Reset menu order</span>
        </button>
      )}
    </>
  );
}

function NavGroup({ group, collapsed, children }: { group: string; collapsed: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<{ kind: 'item' } | { kind: 'group'; edge: Edge } | null>(null);

  useEffect(() => {
    if (!ref.current || !handle.current) return;
    const element = ref.current;
    return combine(
      draggable({
        element,
        dragHandle: handle.current,
        getInitialData: () => ({ type: 'nav-group', group }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.type === 'nav-item' || (source.data.type === 'nav-group' && source.data.group !== group),
        getData: ({ input }) => ({ type: 'nav-group', group, edge: edgeOf(element, input) }),
        onDrag: ({ self, source, location }) => {
          // an item over one of this group's links shows that link's line instead
          if (location.current.dropTargets[0]?.element !== element) return setOver(null);
          setOver(source.data.type === 'nav-group' ? { kind: 'group', edge: self.data.edge as Edge } : { kind: 'item' });
        },
        onDragLeave: () => setOver(null),
        onDrop: () => setOver(null),
      }),
    );
  }, [group]);

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex items-center gap-0.5 rounded-md md:flex-col md:items-stretch',
        dragging && 'opacity-40',
        over?.kind === 'item' && 'bg-sidebar-accent/60',
      )}
    >
      {over?.kind === 'group' && <DropLine edge={over.edge} />}
      <div
        ref={handle}
        title="Drag to move this group"
        className={cn(
          'group/h hidden cursor-grab items-center gap-1 px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase select-none active:cursor-grabbing',
          collapsed ? 'md:flex md:h-3 md:p-0' : 'md:flex',
        )}
      >
        {collapsed ? <span className="mx-1.5 w-full border-t border-sidebar-border" /> : (
          <>
            {group}
            <GripVertical className="ml-auto size-3 opacity-0 transition-opacity group-hover/h:opacity-60" />
          </>
        )}
      </div>
      {children}
    </div>
  );
}

function NavLink({ item, group, collapsed, counter, onKeyDown }: {
  item: NavItem; group: string; collapsed: boolean; counter?: { n: number; tone: Tone }; onKeyDown: (e: KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<Edge | null>(null);
  const { to, label, icon: Icon } = item;

  useEffect(() => {
    if (!ref.current) return;
    const element = ref.current;
    return combine(
      draggable({
        element,
        getInitialData: () => ({ type: 'nav-item', to }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        // the dragged item is a target too (dropping on itself changes nothing), so its group is not lit up under it
        canDrop: ({ source }) => source.data.type === 'nav-item',
        getData: ({ input }) => ({ type: 'nav-item', to, group, edge: edgeOf(element, input) }),
        onDrag: ({ self, source }) => setEdge(source.data.to === to ? null : (self.data.edge as Edge)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null),
      }),
    );
  }, [to, group]);

  return (
    <Link
      ref={ref}
      to={to}
      title={collapsed ? label : undefined}
      aria-description="Drag, or Alt+Arrow keys, to move"
      data-nav-item={to}
      onKeyDown={onKeyDown}
      className={cn(
        'group/n relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-[opacity,background-color] select-none hover:bg-sidebar-accent hover:text-foreground',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        collapsed && 'md:justify-center',
        dragging && 'opacity-40',
      )}
      activeProps={{ className: 'bg-sidebar-accent !text-foreground font-medium' }}
    >
      {edge && <DropLine edge={edge} />}
      <GripVertical
        aria-hidden
        className={cn('absolute -left-0.5 hidden size-3 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover/n:opacity-60', !collapsed && 'md:block')}
      />
      <Icon className="size-4 shrink-0" />
      <span className={cn('hidden sm:inline', collapsed && 'md:hidden')}>{label}</span>
      {counter && <Count n={counter.n} tone={counter.tone} className={cn('ml-auto', collapsed && 'md:absolute md:-top-0.5 md:-right-0.5 md:ml-0')} />}
    </Link>
  );
}
