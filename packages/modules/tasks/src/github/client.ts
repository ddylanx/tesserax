// GitHub REST API v3 client. Read-only except postComment(), which is only called after an explicit
// confirmed click in the UI. Uses native fetch; no SDK dependency.

import { createLogger } from '@tesserax/core';

const log = createLogger('tasks.github.client');

export class RateLimitError extends Error {
  constructor(
    message: string,
    readonly resetAt: Date | null,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export interface GithubCredentials {
  token: string;
  /** Base URL override; defaults to https://api.github.com. */
  apiUrl?: string;
}

export interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: { name: string }[];
  assignee: { login: string } | null;
  milestone: { title: string } | null;
  user: { login: string } | null;
  /** Present on pull requests returned by the issues endpoint; these are filtered out. */
  pull_request?: unknown;
}

export interface GithubComment {
  id: number;
  user: { login: string } | null;
  created_at: string;
  body: string;
}

const MAX_PAGES = 20;

export class GithubClient {
  private readonly base: string;
  private readonly token: string;

  constructor(
    creds: GithubCredentials,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.token = creds.token;
    this.base = (creds.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${this.token}`,
      ...extra,
    };
  }

  private throwIfRateLimit(res: Response): void {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if ((res.status === 403 || res.status === 429) && remaining === '0') {
      const resetSec = res.headers.get('x-ratelimit-reset');
      const resetAt = resetSec ? new Date(Number(resetSec) * 1000) : null;
      throw new RateLimitError(
        `GitHub rate limit exceeded. Resets at ${resetAt?.toISOString() ?? 'unknown'}.`,
        resetAt,
      );
    }
  }

  private async parseError(res: Response): Promise<string> {
    const body = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(body) as { message?: string };
      return parsed.message ?? body;
    } catch {
      return body;
    }
  }

  async listIssues(opts: {
    repo: string;
    labels?: string[];
    assignee?: string;
    etag?: string | null;
  }): Promise<{ notModified: true } | { issues: GithubIssue[]; etag: string | null; truncated: boolean }> {
    const baseUrl = new URL(`${this.base}/repos/${opts.repo}/issues`);
    baseUrl.searchParams.set('state', 'open');
    baseUrl.searchParams.set('per_page', '100');
    if (opts.labels?.length) baseUrl.searchParams.set('labels', opts.labels.join(','));
    if (opts.assignee) baseUrl.searchParams.set('assignee', opts.assignee);

    const issues: GithubIssue[] = [];
    let pageUrl: string | null = baseUrl.toString();
    let resultEtag: string | null = null;
    let pageNum = 0;
    let truncated = false;

    while (pageUrl) {
      pageNum++;
      const reqHeaders = this.headers(
        pageNum === 1 && opts.etag ? { 'If-None-Match': opts.etag } : {},
      );

      let res: Response;
      try {
        res = await this.fetchFn(pageUrl, {
          headers: reqHeaders,
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        const err = e as { name?: string; cause?: { code?: string } };
        throw new Error(
          `Could not reach GitHub: ${err.cause?.code ?? err.name ?? 'network error'}.`,
        );
      }

      if (pageNum === 1 && res.status === 304) return { notModified: true };

      this.throwIfRateLimit(res);

      if (res.status === 401) {
        // Never echo the token
        throw new Error(`GitHub authentication failed (401). Check GITHUB_TOKEN.`);
      }
      if (!res.ok) {
        const msg = await this.parseError(res);
        throw new Error(`GitHub API error (${res.status}): ${msg.slice(0, 400)}`);
      }

      const data = (await res.json()) as GithubIssue[];
      // Drop pull requests – the issues endpoint returns them too
      const filtered = data.filter(i => !i.pull_request);
      issues.push(...filtered);

      const link = res.headers.get('link') ?? '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;

      // Only retain ETag when results fit on a single page.
      // Multi-page repos could have changes on later pages that wouldn't update page 1's ETag.
      if (pageNum === 1 && !next) {
        resultEtag = res.headers.get('etag');
      }

      if (pageNum >= MAX_PAGES) {
        truncated = Boolean(next);
        break;
      }

      pageUrl = next;
    }

    return { issues, etag: resultEtag, truncated };
  }

  async getComments(repo: string, number: number): Promise<GithubComment[]> {
    const comments: GithubComment[] = [];
    let pageUrl: string | null = `${this.base}/repos/${repo}/issues/${number}/comments?per_page=100`;
    let pages = 0;
    while (pageUrl && pages < 10) {
      pages++;
      let res: Response;
      try {
        res = await this.fetchFn(pageUrl, {
          headers: this.headers(),
          signal: AbortSignal.timeout(20_000),
        });
      } catch (e) {
        const err = e as { name?: string; cause?: { code?: string } };
        throw new Error(
          `Could not reach GitHub: ${err.cause?.code ?? err.name ?? 'network error'}.`,
        );
      }
      this.throwIfRateLimit(res);
      if (!res.ok) {
        const msg = await this.parseError(res);
        throw new Error(`GitHub getComments error (${res.status}): ${msg.slice(0, 400)}`);
      }
      const data = (await res.json()) as GithubComment[];
      comments.push(...data);
      const link = res.headers.get('link') ?? '';
      pageUrl = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return comments;
  }

  async postComment(repo: string, number: number, body: string): Promise<{ id: number }> {
    const url = `${this.base}/repos/${repo}/issues/${number}/comments`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ body }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      const err = e as { name?: string; cause?: { code?: string } };
      throw new Error(
        `Could not reach GitHub: ${err.cause?.code ?? err.name ?? 'network error'}.`,
      );
    }
    this.throwIfRateLimit(res);
    if (res.status === 401) {
      throw new Error(`GitHub authentication failed (401). Check GITHUB_TOKEN.`);
    }
    if (!res.ok) {
      const msg = await this.parseError(res);
      throw new Error(`GitHub API error (${res.status}): ${msg.slice(0, 400)}`);
    }
    return res.json() as Promise<{ id: number }>;
  }

  async getUser(): Promise<{ login: string }> {
    const res = await this.fetchFn(`${this.base}/user`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    this.throwIfRateLimit(res);
    if (!res.ok) throw new Error(`GitHub /user returned ${res.status}.`);
    return res.json() as Promise<{ login: string }>;
  }

  async getRepo(repo: string): Promise<{ full_name: string; private: boolean }> {
    const res = await this.fetchFn(`${this.base}/repos/${repo}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10_000),
    });
    this.throwIfRateLimit(res);
    if (!res.ok) throw new Error(`GitHub /repos/${repo} returned ${res.status}.`);
    return res.json() as Promise<{ full_name: string; private: boolean }>;
  }
}
