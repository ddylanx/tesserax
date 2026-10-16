import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { Project } from '@tesserax/contracts';
import { Page, QueryState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { ProjectDot, useProjectScope } from '@/lib/project-context';

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** One card per project: what is running, what waits for you, what failed. */
export function ProjectsPage() {
  const { projects, selected, setSelected } = useProjectScope();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api<Project>('/api/projects', { method: 'POST', body: JSON.stringify({ slug: slugify(name), name: name.trim() }) }),
    onSuccess: p => {
      setName('');
      qc.invalidateQueries({ queryKey: ['projects'] });
      navigate({ to: '/projects/$slug', params: { slug: p.slug } });
    },
  });
  return (
    <Page title="Projects" description="Each project has its own tasks, workplaces, workflows, skills and agents. Pick one in the top bar to filter every page.">
      <QueryState isLoading={false} error={null} empty={projects.length === 0} emptyText="No projects yet." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map(p => (
          <Card key={p.id} className={selected === p.slug ? 'ring-2 ring-primary/40' : ''}>
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex items-center gap-2">
                <ProjectDot color={p.color} name={p.name} />
                <Link to="/projects/$slug" params={{ slug: p.slug }} className="font-semibold hover:underline">{p.name}</Link>
                <Badge variant="outline">{p.kind}</Badge>
                {p.isDefault && <Badge variant="slate" title="Receives tasks no project rule matches">default</Badge>}
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="blue">{p.summary.inProgress} in progress</Badge>
                <Badge variant={p.summary.waitingForYou ? 'amber' : 'default'}>{p.summary.waitingForYou} waiting for you</Badge>
                <Badge variant={p.summary.failedRuns ? 'red' : 'default'}>{p.summary.failedRuns} failed runs</Badge>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setSelected(selected === p.slug ? '' : p.slug)}>{selected === p.slug ? 'Show all' : 'Focus on it'}</Button>
                <Link to="/projects/$slug" params={{ slug: p.slug }}><Button size="sm" variant="ghost">Open</Button></Link>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-4 text-sm">
          New project:
          <Input className="w-56" placeholder="name, e.g. Tesserax" value={name} onChange={e => setName(e.target.value)} />
          <Button size="sm" disabled={!slugify(name) || create.isPending} onClick={() => create.mutate()}><Plus className="size-3.5" />Create</Button>
          {create.error && <span className="text-red-600">{(create.error as Error).message}</span>}
        </CardContent>
      </Card>
    </Page>
  );
}
