import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** "git@bitbucket.org:ws/repo.git", "https://user@bitbucket.org/ws/repo.git" -> { workspace, slug } */
export function parseBitbucketRemote(url: string): { workspace: string; slug: string } | null {
  const m = url.trim().match(/bitbucket\.org[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? { workspace: m[1]!, slug: m[2]! } : null;
}

const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=15' });

export async function remoteUrl(repoPath: string, remote: string): Promise<string> {
  const { stdout } = await exec('git', ['remote', 'get-url', remote], { cwd: repoPath, env: gitEnv() });
  return stdout.trim();
}

/** Pushes the ticket branch (never --force). Uses the user's own git credentials (SSH agent / keychain). */
export async function pushBranch(worktree: string, remote: string, branch: string): Promise<string> {
  const { stdout, stderr } = await exec('git', ['push', '--set-upstream', remote, `${branch}:${branch}`], {
    cwd: worktree, env: gitEnv(), timeout: 120_000,
  });
  return `${stdout}${stderr}`.trim();
}

export class BitbucketError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

export interface PullRequest {
  id: number;
  url: string;
  state: string;
  existing: boolean;
}

/** Minimal Bitbucket Cloud REST v2 client (Atlassian API token, Basic auth with the account email). */
export class BitbucketClient {
  private readonly auth: string;

  constructor(private readonly o: { baseUrl: string; email: string; token: string }, private readonly fetchFn: typeof fetch = fetch) {
    this.auth = `Basic ${Buffer.from(`${o.email.trim()}:${o.token.trim()}`).toString('base64')}`;
  }

  async request<T>(path: string, init: { method?: string; body?: unknown; params?: Record<string, string> } = {}): Promise<T> {
    const url = new URL(`${this.o.baseUrl.replace(/\/+$/, '')}${path}`);
    for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
    const res = await this.fetchFn(url, {
      method: init.method ?? 'GET',
      headers: { authorization: this.auth, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    }).catch(e => {
      throw new BitbucketError(`Could not reach Bitbucket: ${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message}`);
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 400);
      let msg = text;
      try {
        msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
      } catch {
        /* plain text */
      }
      const hint = res.status === 401 || res.status === 403
        ? ' Check BITBUCKET_API_TOKEN (an Atlassian API token with Bitbucket scopes read:repository and write:pullrequest) and BITBUCKET_EMAIL.'
        : '';
      throw new BitbucketError(`Bitbucket ${res.status}: ${msg.split(this.o.token).join('[token]')}${hint}`, res.status);
    }
    return (await res.json()) as T;
  }

  /** Opens a PR from `source` into `destination`, or returns the open PR that already exists for the branch. */
  async openPullRequest(p: { workspace: string; slug: string; title: string; description: string; source: string; destination: string }): Promise<PullRequest> {
    const repo = `/repositories/${encodeURIComponent(p.workspace)}/${encodeURIComponent(p.slug)}`;
    const open = await this.request<{ values?: Array<{ id: number; state: string; links: { html: { href: string } } }> }>(`${repo}/pullrequests`, {
      params: { q: `source.branch.name="${p.source}" AND state="OPEN"` },
    });
    const found = open.values?.[0];
    if (found) return { id: found.id, url: found.links.html.href, state: found.state, existing: true };
    const pr = await this.request<{ id: number; state: string; links: { html: { href: string } } }>(`${repo}/pullrequests`, {
      method: 'POST',
      body: {
        title: p.title,
        description: p.description,
        source: { branch: { name: p.source } },
        destination: { branch: { name: p.destination } },
        close_source_branch: false,
      },
    });
    return { id: pr.id, url: pr.links.html.href, state: pr.state, existing: false };
  }
}

export interface PrRef {
  workspace: string;
  slug: string;
  id: number;
  url: string;
}

/** ".../workspace/repo/pull-requests/123" -> parts */
export function parsePrUrl(url: string): PrRef | null {
  const m = url.match(/bitbucket\.org\/([\w.-]+)\/([\w.-]+)\/pull-requests\/(\d+)/i);
  return m ? { workspace: m[1]!, slug: m[2]!, id: Number(m[3]), url } : null;
}

/** The open PR whose source branch is `source`, if any. */
export async function findOpenPr(client: BitbucketClient, workspace: string, slug: string, source: string): Promise<PrRef | null> {
  const r = await client.request<{ values?: Array<{ id: number; links: { html: { href: string } } }> }>(
    `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/pullrequests`,
    { params: { q: `source.branch.name="${source}" AND state="OPEN"` } },
  );
  const pr = r.values?.[0];
  return pr ? { workspace, slug, id: pr.id, url: pr.links.html.href } : null;
}

/** Posts a general (non-inline) comment on a PR. Markdown. */
export async function commentOnPr(client: BitbucketClient, pr: PrRef, markdown: string): Promise<{ id: number }> {
  return client.request<{ id: number }>(
    `/repositories/${encodeURIComponent(pr.workspace)}/${encodeURIComponent(pr.slug)}/pullrequests/${pr.id}/comments`,
    { method: 'POST', body: { content: { raw: markdown } } },
  );
}
