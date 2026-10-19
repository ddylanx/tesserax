import { spawn } from 'node:child_process';
import type { McpToolItem } from '@tesserax/contracts';

/**
 * Probes an MCP server for its list of available tools using the JSON-RPC 2.0 protocol.
 * For stdio: spawns child process, performs initialize handshake, calls tools/list, and cleans up.
 * For http/sse: sends JSON-RPC POST request to endpoint URL.
 */
export async function probeMcpTools(definition: Record<string, unknown>, timeoutMs = 5000): Promise<McpToolItem[]> {
  const url = typeof definition.url === 'string' ? definition.url : null;
  if (url) {
    return probeHttpTools(url, timeoutMs);
  }

  const command = typeof definition.command === 'string' ? definition.command : null;
  if (!command) {
    throw new Error('Server definition lacks command or url');
  }

  const args = Array.isArray(definition.args) ? definition.args.map(String) : [];
  const rawEnv = typeof definition.env === 'object' && definition.env !== null ? (definition.env as Record<string, unknown>) : {};
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  for (const [k, v] of Object.entries(rawEnv)) {
    if (v !== undefined && v !== null) env[k] = String(v);
  }

  return new Promise<McpToolItem[]>((resolve, reject) => {
    let resolved = false;
    let stdoutBuffer = '';
    let stderrBuffer = '';

    const cleanup = (child?: any) => {
      if (child) {
        try {
          child.kill('SIGTERM');
        } catch {
          /* already terminated */
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* gone */
          }
        }, 500).unref();
      }
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new Error(`Failed to spawn MCP server ${command}: ${(err as Error).message}`));
    }

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup(child);
      reject(new Error(`MCP probe timed out after ${timeoutMs}ms (${command})`));
    }, timeoutMs);

    const safeReject = (err: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup(child);
      reject(err);
    };

    const safeResolve = (tools: McpToolItem[]) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      cleanup(child);
      resolve(tools);
    };

    child.on('error', err => safeReject(new Error(`MCP server process error: ${err.message}`)));
    child.stdin?.on('error', () => {
      /* ignore EPIPE or write errors, process exit or error will reject */
    });

    child.stderr?.on('data', chunk => {
      stderrBuffer += chunk.toString();
    });

    child.on('close', code => {
      if (!resolved) {
        safeReject(new Error(`MCP server exited early with code ${code}. Stderr: ${stderrBuffer.slice(-500)}`));
      }
    });

    let initialized = false;

    // Send initialize request
    const initReq = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'tesserax', version: '1.0.0' },
      },
    }) + '\n';

    child.stdin?.write(initReq);

    child.stdout?.on('data', chunk => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? ''; // keep trailing incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const msg = JSON.parse(trimmed) as { id?: number; result?: any; error?: any };
          if (msg.error) {
            safeReject(new Error(`MCP RPC error: ${JSON.stringify(msg.error)}`));
            return;
          }
          if (msg.id === 1 && !initialized) {
            initialized = true;
            // Send notifications/initialized then tools/list
            child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
            child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
          } else if (msg.id === 2) {
            const rawTools = msg.result?.tools;
            if (!Array.isArray(rawTools)) {
              safeResolve([]);
              return;
            }
            const tools: McpToolItem[] = rawTools.map((t: any) => ({
              name: String(t.name),
              description: t.description ? String(t.description) : undefined,
            }));
            safeResolve(tools);
            return;
          }
        } catch {
          // not valid json line, ignore
        }
      }
    });
  });
}

async function probeHttpTools(url: string, timeoutMs: number): Promise<McpToolItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = (await res.json()) as { result?: { tools?: any[] }; error?: any };
    if (data.error) {
      throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
    }
    const rawTools = data.result?.tools ?? [];
    return rawTools.map((t: any) => ({
      name: String(t.name),
      description: t.description ? String(t.description) : undefined,
    }));
  } finally {
    clearTimeout(timer);
  }
}
