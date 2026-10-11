import type { ReactNode } from 'react';

export function Page({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function QueryState({ isLoading, error, empty, emptyText }: { isLoading: boolean; error: unknown; empty?: boolean; emptyText?: string }) {
  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="p-4 text-sm text-red-600">{String((error as Error).message ?? error)}</p>;
  if (empty) return <p className="p-4 text-sm text-muted-foreground">{emptyText ?? 'Nothing here yet.'}</p>;
  return null;
}
