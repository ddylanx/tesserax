// Jira Cloud REST v3 client. Request handling (login-reason check, gateway fallback for scoped tokens,
// plain-language errors, rate-limit hints, sprint field lookup) is ported from agent-cockpit/src/jira.mjs.
// Read-only except addComment(), which is only called after an explicit, confirmed click in the UI.

export interface JiraCredentials {
  /** Site host (yourcompany.atlassian.net) or a full https URL. */
  site: string;
  email: string;
  token: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: Record<string, any>;
}

export const SEARCH_FIELDS = [
  'summary', 'status', 'priority', 'assignee', 'reporter', 'project', 'issuetype', 'labels', 'components',
  'duedate', 'created', 'updated', 'parent', 'description',
];
export const DETAIL_FIELDS = [...SEARCH_FIELDS, 'comment', 'attachment'];

export const DEFAULT_JQL =
  '(assignee = currentUser() AND statusCategory != Done) OR (assignee = currentUser() AND updated >= -14d) ORDER BY updated DESC';

const MAX_PAGES = 20;

export class JiraError extends Error {
  constructor(message: string, readonly status: number | null = null, readonly retryAfterMs: number | null = null) {
    super(message);
  }
}

const explain = (status: number, retryAfterMs?: number | null) =>
  ({
    401: 'Jira rejected the email or API token (401). Create a fresh token for the same Atlassian account.',
    403: 'Jira says this account may not do that (403). Check the JQL or your project permissions.',
    404: 'Not found on this Jira site (404). Check the site name or issue key.',
    429: `Jira is rate limiting requests (429). Try again in ${Math.ceil((retryAfterMs || 60e3) / 1000)}s.`,
  })[status] ?? `Jira returned an error (${status}).`;

/** "yourcompany.atlassian.net" or "https://yourcompany.atlassian.net/jira/..." -> "yourcompany.atlassian.net" */
export function normalizeSite(s: string): string {
  const host = String(s || '').trim().replace(/^https?:\/\//i, '').split(/[/?#]/)[0]!.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/.test(host)) throw new JiraError('That does not look like a Jira site, e.g. yourcompany.atlassian.net');
  return host;
}

export class JiraClient {
  readonly site: string;
  private base: string;
  private baseResolved = false;
  private readonly auth: string;

  constructor(private readonly creds: JiraCredentials, private readonly fetchFn: typeof fetch = fetch) {
    this.site = normalizeSite(creds.site);
    const m = creds.site.match(/^(https?:\/\/[^/]+)/i);
    this.base = m ? m[1]! : `https://${this.site}`;
    this.auth = `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString('base64')}`;
  }

  browseUrl(key: string) {
    const web = this.base.startsWith('https://api.atlassian.com') ? `https://${this.site}` : this.base;
    return `${web}/browse/${encodeURIComponent(key)}`;
  }

  /** Never let the token leak through an error message. */
  private scrub(msg: string) {
    return msg.split(this.creds.token || '\u0000').join('[token]');
  }

  private async request<T>(path: string, init: { method?: string; params?: Record<string, unknown>; body?: unknown; base?: string } = {}): Promise<T> {
    const url = new URL(`${init.base ?? this.base}${path}`);
    for (const [k, v] of Object.entries(init.params ?? {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: init.method ?? 'GET',
        headers: { accept: 'application/json', authorization: this.auth, ...(init.body ? { 'content-type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      const err = e as { cause?: { code?: string }; name?: string };
      throw new JiraError(`Could not reach ${this.site}: ${err.cause?.code || err.name || 'network error'}.`);
    }
    // Jira Cloud may answer bad credentials as an anonymous user (empty results) instead of 401.
    const login = String(res.headers.get('x-seraph-loginreason') ?? '');
    if (/AUTHENTICATED_FAILED|AUTHENTICATION_DENIED/i.test(login)) {
      throw new JiraError('Jira did not accept the email and API token, so it answered as an anonymous user with no tickets.', 401);
    }
    if (!res.ok) {
      const ra = res.headers.get('retry-after');
      const retryAfterMs = res.status === 429 ? (ra && !isNaN(Number(ra)) ? Number(ra) * 1000 : Date.parse(ra ?? '') - Date.now() || 60e3) : null;
      throw new JiraError(this.scrub(explain(res.status, retryAfterMs)), res.status, retryAfterMs);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** Plain API tokens work on the site; "API tokens with scopes" only via https://api.atlassian.com/ex/jira/<cloudId>. */
  async resolveBase(): Promise<string> {
    if (this.baseResolved) return this.base;
    try {
      await this.request('/rest/api/3/myself');
      this.baseResolved = true;
      return this.base;
    } catch (e) {
      if (!(e instanceof JiraError) || (e.status !== 401 && e.status !== 403)) throw e;
    }
    let cloudId: string | null = null;
    try {
      const r = await this.fetchFn(new URL(`https://${this.site}/_edge/tenant_info`), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      cloudId = r.ok ? ((await r.json()) as { cloudId?: string }).cloudId ?? null : null;
    } catch {
      /* no gateway */
    }
    if (!cloudId) throw new JiraError(explain(401), 401);
    const gateway = `https://api.atlassian.com/ex/jira/${cloudId}`;
    await this.request('/rest/api/3/myself', { base: gateway });
    this.base = gateway;
    this.baseResolved = true;
    return gateway;
  }

  /** The site's Sprint custom field id, if it has one (Jira Software). */
  async findSprintField(): Promise<string | null> {
    await this.resolveBase();
    const fields = await this.request<Array<{ id: string; name?: string; custom?: boolean; schema?: { custom?: string } }>>('/rest/api/3/field');
    const list = Array.isArray(fields) ? fields : [];
    const f = list.find(x => x.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint') ?? list.find(x => x.custom && x.name === 'Sprint');
    return f?.id ?? null;
  }

  /** Every issue the JQL returns, following nextPageToken until isLast (GET /rest/api/3/search/jql). */
  async search(jql: string, extraFields: string[] = []): Promise<{ issues: JiraIssue[]; truncated: boolean }> {
    await this.resolveBase();
    const issues: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.request<{ issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean }>('/rest/api/3/search/jql', {
        params: { jql, fields: [...SEARCH_FIELDS, ...extraFields].join(','), maxResults: 100, nextPageToken },
      });
      issues.push(...(body.issues ?? []));
      nextPageToken = body.nextPageToken;
      if (body.isLast || !nextPageToken) return { issues, truncated: false };
    }
    return { issues, truncated: true };
  }

  /** One issue with comments and attachment metadata. */
  async getIssue(keyOrId: string): Promise<JiraIssue> {
    await this.resolveBase();
    return this.request<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(keyOrId)}`, { params: { fields: DETAIL_FIELDS.join(',') } });
  }

  /** The only write: a plain-text comment. Callers must hold an explicit user confirmation. */
  async addComment(keyOrId: string, text: string): Promise<{ id: string }> {
    await this.resolveBase();
    const body = {
      type: 'doc',
      version: 1,
      content: text
        .split(/\n{2,}/)
        .map(p => ({ type: 'paragraph', content: p.trim() ? [{ type: 'text', text: p.trim() }] : [] })),
    };
    return this.request<{ id: string }>(`/rest/api/3/issue/${encodeURIComponent(keyOrId)}/comment`, { method: 'POST', body: { body } });
  }
}
