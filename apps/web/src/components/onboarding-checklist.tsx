import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CheckCircle2, Circle, ExternalLink, Play, Sparkles, X } from 'lucide-react';
import type { DemoRepoResponse, RepoRegistryView, SystemInfo, TaskDetailDto, TaskList } from '@tesserax/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useProjectScope } from '@/lib/project-context';

export function OnboardingChecklist({
  totalRuns = 0,
  onClose,
}: {
  totalRuns?: number;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const scope = useProjectScope();

  const systemQ = useQuery({
    queryKey: ['system'],
    queryFn: () => api<SystemInfo>('/api/system'),
    refetchInterval: 10_000,
  });

  const reposQ = useQuery({
    queryKey: ['repos'],
    queryFn: () => api<RepoRegistryView>('/api/repos'),
  });

  const tasksQ = useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: () => api<TaskList>('/api/tasks'),
  });

  const env = systemQ.data?.environment;
  const workplaces = reposQ.data?.workplaces ?? [];
  const tasks = tasksQ.data?.tasks ?? [];

  const step1Done = Boolean(env?.ready);
  const step2Done = workplaces.length > 0;
  const step3Done = tasks.length > 0;
  const step4Done = totalRuns > 0;

  const completedCount = [step1Done, step2Done, step3Done, step4Done].filter(Boolean).length;
  const currentStep = Math.min(completedCount + 1, 4);

  const demoRepoMutation = useMutation({
    mutationFn: () => api<DemoRepoResponse>('/api/repos/demo', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repos'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      const defaultProj = scope.projects.find(p => p.isDefault) ?? scope.projects[0];
      const projectSlug = defaultProj?.slug ?? 'default';
      const targetWorkplace = workplaces.find(w => w.id === 'demo-app')?.id ?? workplaces[0]?.id ?? 'demo-app';
      return api<TaskDetailDto>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          projectSlug,
          title: 'Add a /health endpoint',
          description: 'Add a /health endpoint that returns JSON { status: "ok" } and passes tests.',
          type: 'Task',
          workplaceId: targetWorkplace,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const runWorkflowMutation = useMutation({
    mutationFn: async () => {
      const targetTask = tasks[0];
      if (!targetTask) throw new Error('No task available to run.');
      return api<{ runId: string }>(`/api/tasks/${targetTask.id}/workflow-runs`, {
        method: 'POST',
        body: JSON.stringify({ workflowId: 'default' }),
      });
    },
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['wf', 'runs'] });
      navigate({ to: '/runs/$runId', params: { runId: res.runId } });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Get started with Tesserax</h2>
          <Badge variant={completedCount === 4 ? 'green' : 'blue'}>
            Step {currentStep} of 4
          </Badge>
        </div>
        {totalRuns > 0 && onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} className="text-muted-foreground">
            <X className="h-4 w-4" /> Close checklist
          </Button>
        )}
      </div>

      <div className="grid gap-4">
        {/* Step 1: Environment */}
        <Card className={step1Done ? 'border-emerald-500/40 bg-emerald-500/5' : ''}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              {step1Done ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
              <CardTitle>1. Environment check</CardTitle>
            </div>
            {step1Done && <Badge variant="green">Ready</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Requires Postgres, git on your PATH, and at least one AI agent CLI.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={env?.postgres === 'ok' ? 'green' : 'red'}>
                Postgres: {env?.postgres ?? 'checking...'}
              </Badge>
              <Badge variant={env?.git ? 'green' : 'red'}>
                Git: {env?.git ? 'found' : 'not found'}
              </Badge>
              {(env?.agents ?? []).map(a => {
                if (a.signedIn === 'yes') {
                  return <Badge key={a.id} variant="green">{a.name}: ready</Badge>;
                }
                if (a.installed) {
                  return (
                    <div key={a.id} className="inline-flex items-center gap-1">
                      <Badge variant="amber">{a.name}: installed, sign-in not checked</Badge>
                      <span className="text-xs text-muted-foreground">run <code className="rounded bg-muted px-1 py-0.5 font-mono">{a.signInCommand}</code></span>
                    </div>
                  );
                }
                return <Badge key={a.id} variant="outline">{a.name}: not installed</Badge>;
              })}
            </div>
          </CardContent>
        </Card>

        {/* Step 2: Repository */}
        <Card className={step2Done ? 'border-emerald-500/40 bg-emerald-500/5' : ''}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              {step2Done ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
              <CardTitle>2. Add a repository</CardTitle>
            </div>
            {step2Done && <Badge variant="green">Ready</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Workflows run inside git worktrees of registered repositories. Start with a sample repo or register an existing one.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant={step2Done ? 'outline' : 'default'}
                disabled={demoRepoMutation.isPending}
                onClick={() => demoRepoMutation.mutate()}
              >
                <Sparkles className="h-4 w-4" />
                {demoRepoMutation.isPending ? 'Creating demo repo...' : step2Done ? 'Demo repo ready (re-create)' : 'Use the demo repo'}
              </Button>
              <Link to="/repos" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                or register a local repository <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            {demoRepoMutation.error && (
              <p className="text-xs text-red-600">Failed to create demo repo: {(demoRepoMutation.error as Error).message}</p>
            )}
          </CardContent>
        </Card>

        {/* Step 3: First Task */}
        <Card className={step3Done ? 'border-emerald-500/40 bg-emerald-500/5' : ''}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              {step3Done ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
              <CardTitle>3. Create your first task</CardTitle>
            </div>
            {step3Done && <Badge variant="green">Ready</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Each workflow run is attached to a task. Create a sample task to test the workflow.
            </p>
            <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-xs">Suggested task</span>
                <Badge variant="outline">demo-app</Badge>
              </div>
              <div className="font-semibold">Add a /health endpoint</div>
              <div className="text-xs text-muted-foreground">
                Add a /health endpoint that returns JSON &#123; status: &apos;ok&apos; &#125; and passes tests.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant={step3Done ? 'outline' : 'default'}
                disabled={createTaskMutation.isPending}
                onClick={() => createTaskMutation.mutate()}
              >
                {createTaskMutation.isPending ? 'Creating task...' : 'Create sample task'}
              </Button>
              <Button size="sm" variant="outline" disabled title="GitHub Issues sync will arrive in TX-102">
                Connect GitHub Issues (coming soon)
              </Button>
            </div>
            {createTaskMutation.error && (
              <p className="text-xs text-red-600">Failed to create task: {(createTaskMutation.error as Error).message}</p>
            )}
          </CardContent>
        </Card>

        {/* Step 4: Run default workflow */}
        <Card className={step4Done ? 'border-emerald-500/40 bg-emerald-500/5' : ''}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              {step4Done ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
              <CardTitle>4. Run default workflow</CardTitle>
            </div>
            {step4Done && <Badge variant="green">Ready</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              The default workflow will pause at Review analysis (first gate) so you can review and edit what the AI plans to change before any code is written.
            </p>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                disabled={tasks.length === 0 || runWorkflowMutation.isPending}
                onClick={() => runWorkflowMutation.mutate()}
              >
                <Play className="h-4 w-4" />
                {runWorkflowMutation.isPending ? 'Starting workflow...' : 'Start default workflow'}
              </Button>
              {tasks.length === 0 && (
                <span className="text-xs text-muted-foreground">Create a task first in Step 3.</span>
              )}
            </div>
            {runWorkflowMutation.error && (
              <p className="text-xs text-red-600">Failed to start workflow: {(runWorkflowMutation.error as Error).message}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
