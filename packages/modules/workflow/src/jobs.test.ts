import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Db } from '@tesserax/db';
import { finalizeAgentJob, type JobDeps } from './jobs';

function createMockDeps(nodeRun: any, workflowRun: any): { deps: JobDeps; completed: any[]; artifacts: any[] } {
  const completed: any[] = [];
  const artifacts: any[] = [];

  const db = {
    selectFrom: (table: string) => ({
      selectAll: () => ({
        where: (_col: string, _op: string, _val: any) => ({
          executeTakeFirst: async () => (table === 'node_runs' ? nodeRun : workflowRun),
          executeTakeFirstOrThrow: async () => (table === 'node_runs' ? nodeRun : workflowRun),
        }),
      }),
    }),
  } as unknown as Db;

  const engine = {
    node: () => ({
      id: 'node-1',
      type: 'agent.run',
      config: { prompt: 'Do something', output: 'implementation' },
    }),
    saveArtifact: async (_runId: string, _nodeRunId: string, output: string, content: string, _source: string) => {
      artifacts.push({ output, content });
    },
    patchNode: async () => {},
    complete: async (nodeRunId: string, status: string, meta: any) => {
      completed.push({ nodeRunId, status, meta });
    },
  };

  const deps = {
    db,
    engine,
    tasks: {} as any,
    classifier: {} as any,
    skills: {} as any,
    config: {} as any,
    queue: {} as any,
  } as unknown as JobDeps;

  return { deps, completed, artifacts };
}

test('finalizeAgentJob removes ephemeral mcp.json on agent completion', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'wf-job-test-'));
  try {
    const mcpFile = join(runDir, 'mcp.json');
    const exitFile = join(runDir, 'exit_code');
    const stdoutFile = join(runDir, 'stdout.json');

    writeFileSync(mcpFile, JSON.stringify({ mcpServers: { db: { command: 'pg' } } }), 'utf8');
    writeFileSync(exitFile, '0', 'utf8');
    writeFileSync(stdoutFile, JSON.stringify({ result: 'Task finished successfully' }), 'utf8');

    assert.equal(existsSync(mcpFile), true);

    const nodeRun = {
      id: 'nr-1',
      run_id: 'run-1',
      node_id: 'node-1',
      status: 'running',
      run_dir: runDir,
      process_id: null,
    };
    const workflowRun = {
      id: 'run-1',
      workflow_snapshot: {},
      worktree_path: null,
      base_ref: null,
    };

    const { deps, completed } = createMockDeps(nodeRun, workflowRun);

    await finalizeAgentJob(deps, { nodeRunId: 'nr-1' });

    assert.equal(existsSync(mcpFile), false, 'mcp.json must be cleaned up on finalize');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, 'done');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('finalizeAgentJob removes ephemeral mcp.json even if agent failed', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'wf-job-fail-test-'));
  try {
    const mcpFile = join(runDir, 'mcp.json');
    const exitFile = join(runDir, 'exit_code');
    const stdoutFile = join(runDir, 'stdout.json');

    writeFileSync(mcpFile, JSON.stringify({ mcpServers: { db: { command: 'pg' } } }), 'utf8');
    writeFileSync(exitFile, '1', 'utf8');
    writeFileSync(stdoutFile, JSON.stringify({ error: { message: 'Agent crashed' } }), 'utf8');

    assert.equal(existsSync(mcpFile), true);

    const nodeRun = {
      id: 'nr-2',
      run_id: 'run-1',
      node_id: 'node-1',
      status: 'running',
      run_dir: runDir,
      process_id: null,
    };
    const workflowRun = {
      id: 'run-1',
      workflow_snapshot: {},
      worktree_path: null,
      base_ref: null,
    };

    const { deps, completed } = createMockDeps(nodeRun, workflowRun);

    await finalizeAgentJob(deps, { nodeRunId: 'nr-2' });

    assert.equal(existsSync(mcpFile), false, 'mcp.json must be cleaned up on failure');
    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, 'failed');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('finalizeAgentJob succeeds when mcp.json does not exist', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'wf-job-no-mcp-test-'));
  try {
    const exitFile = join(runDir, 'exit_code');
    const stdoutFile = join(runDir, 'stdout.json');

    writeFileSync(exitFile, '0', 'utf8');
    writeFileSync(stdoutFile, JSON.stringify({ result: 'Task finished' }), 'utf8');

    const nodeRun = {
      id: 'nr-3',
      run_id: 'run-1',
      node_id: 'node-1',
      status: 'running',
      run_dir: runDir,
      process_id: null,
    };
    const workflowRun = {
      id: 'run-1',
      workflow_snapshot: {},
      worktree_path: null,
      base_ref: null,
    };

    const { deps, completed } = createMockDeps(nodeRun, workflowRun);

    await finalizeAgentJob(deps, { nodeRunId: 'nr-3' });

    assert.equal(completed.length, 1);
    assert.equal(completed[0].status, 'done');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});
