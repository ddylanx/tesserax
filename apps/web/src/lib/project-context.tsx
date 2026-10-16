import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ProjectCard } from '@tesserax/contracts';
import { api } from '@/lib/api';

const STORAGE_KEY = 'tesserax:project';

interface ProjectScope {
  projects: ProjectCard[];
  /** Slug of the project picked in the top bar; '' = All. */
  selected: string;
  setSelected: (slug: string) => void;
  current: ProjectCard | null;
  /** Query-string pairs to add to a list call, e.g. `project=tx`. */
  scopeParam: string;
}

const Ctx = createContext<ProjectScope>({ projects: [], selected: '', setSelected: () => undefined, current: null, scopeParam: '' });

const readSelected = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [selected, setSel] = useState(readSelected);
  const q = useQuery({ queryKey: ['projects'], queryFn: () => api<{ projects: ProjectCard[] }>('/api/projects'), refetchInterval: 15_000 });
  const projects = q.data?.projects ?? [];
  const setSelected = useCallback((slug: string) => {
    setSel(slug);
    try {
      if (slug) localStorage.setItem(STORAGE_KEY, slug);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
  }, []);
  // a remembered project that no longer exists falls back to All
  const current = projects.find(p => p.slug === selected) ?? null;
  const effective = projects.length && !current ? '' : selected;
  const value = useMemo<ProjectScope>(
    () => ({ projects, selected: effective, setSelected, current, scopeParam: effective ? `project=${encodeURIComponent(effective)}` : '' }),
    [projects, effective, setSelected, current],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useProjectScope = () => useContext(Ctx);

/** The project's color dot; used next to rows when All projects are shown. */
export function ProjectDot({ color, name }: { color?: string | null; name?: string }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: color ?? '#64748b' }} title={name} />;
}
