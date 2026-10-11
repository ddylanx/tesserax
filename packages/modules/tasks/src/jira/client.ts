/** Minimal read-only Jira Cloud REST v3 client (API token auth). */
export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    priority?: { name?: string } | null;
    assignee?: { displayName?: string } | null;
    project?: { key?: string; name?: string };
    issuetype?: { name?: string };
    labels?: string[];
    duedate?: string | null;
    created?: string;
    updated?: string;
  };
}

export const JIRA_FIELDS = ['summary', 'status', 'priority', 'assignee', 'project', 'issuetype', 'labels', 'duedate', 'created', 'updated'];

export const DEFAULT_JQL =
  '(assignee = currentUser() AND statusCategory != Done) OR (assignee = currentUser() AND updated >= -14d) ORDER BY updated DESC';

export class JiraError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type FetchFn = typeof fetch;

export class JiraClient {
  private readonly base: string;
  private readonly auth: string;

  constructor(creds: JiraCredentials, private readonly fetchFn: FetchFn = fetch) {
    this.base = creds.baseUrl.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64')}`;
  }

  browseUrl(key: string) {
    return `${this.base}/browse/${key}`;
  }

  /** All issues matching `jql`, following nextPageToken (POST /rest/api/3/search/jql). Capped at `max`. */
  async search(jql: string, max = 1000): Promise<JiraIssue[]> {
    const out: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    do {
      const res = await this.fetchFn(`${this.base}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: { authorization: this.auth, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ jql, fields: JIRA_FIELDS, maxResults: 100, nextPageToken }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 300);
        throw new JiraError(res.status, `Jira ${res.status}: ${text || res.statusText}`);
      }
      const body = (await res.json()) as { issues?: JiraIssue[]; nextPageToken?: string; isLast?: boolean };
      out.push(...(body.issues ?? []));
      nextPageToken = body.isLast === false || (body.isLast === undefined && body.nextPageToken) ? body.nextPageToken : undefined;
    } while (nextPageToken && out.length < max);
    return out;
  }
}
