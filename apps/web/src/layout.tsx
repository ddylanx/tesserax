import { Link, Outlet } from '@tanstack/react-router';
import { Bot, Boxes, Inbox, ListChecks, Server } from 'lucide-react';

const nav = [
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/mcp', label: 'MCP', icon: Boxes },
  { to: '/system', label: 'System', icon: Server },
] as const;

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 items-center gap-1 border-b bg-card px-3 py-2 md:w-52 md:flex-col md:items-stretch md:border-r md:border-b-0 md:py-4">
        <div className="mr-3 px-2 text-sm font-semibold md:mr-0 md:mb-4">Open Tesseract</div>
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
