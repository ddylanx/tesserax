#!/usr/bin/env node
// A tiny fake GitHub REST API for local testing and CI without tokens.
//   node scripts/fake-github.mjs [port]      (default 4488)
import { createServer } from 'node:http';

export function createFakeGithubState(initialIssues = null) {
  let version = 1;
  let commentSeq = 100;
  const comments = new Map(); // issueNumber -> comment[]

  const defaultIssues = [
    {
      number: 1,
      title: 'Dogfood Tesserax',
      body: 'First issue for testing markdown body',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/1',
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
      labels: [{ name: 'tesserax' }],
      assignee: { login: 'dev' },
      milestone: { title: 'Milestone 1' },
      user: { login: 'alice' },
    },
    {
      number: 2,
      title: 'Issue without tesserax label',
      body: 'No tesserax label',
      state: 'open',
      html_url: 'https://github.com/owner/repo/issues/2',
      created_at: '2026-10-02T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z',
      labels: [{ name: 'bug' }],
      assignee: null,
      milestone: null,
      user: { login: 'bob' },
    },
    {
      number: 3,
      title: 'PR that should be dropped',
      body: 'This is a pull request returned by the issues endpoint',
      state: 'open',
      html_url: 'https://github.com/owner/repo/pull/3',
      created_at: '2026-10-03T10:00:00Z',
      updated_at: '2026-10-03T10:00:00Z',
      labels: [{ name: 'tesserax' }],
      assignee: null,
      milestone: null,
      user: { login: 'charlie' },
      pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/3' },
    },
  ];

  let issues = initialIssues ? JSON.parse(JSON.stringify(initialIssues)) : defaultIssues;

  return {
    get issues() {
      return issues;
    },
    get etag() {
      return `"fake-etag-v${version}"`;
    },
    bumpVersion() {
      version++;
    },
    closeIssue(number) {
      const it = issues.find(i => i.number === number);
      if (it) {
        it.state = 'closed';
        it.updated_at = new Date().toISOString();
        version++;
      }
    },
    removeLabel(number, labelName) {
      const it = issues.find(i => i.number === number);
      if (it) {
        it.labels = it.labels.filter(l => l.name !== labelName);
        it.updated_at = new Date().toISOString();
        version++;
      }
    },
    updateBody(number, newBody) {
      const it = issues.find(i => i.number === number);
      if (it) {
        it.body = newBody;
        it.updated_at = new Date().toISOString();
        version++;
      }
    },
    addIssue(issue) {
      issues.push(issue);
      version++;
    },
    addComment(issueNumber, comment) {
      const list = comments.get(issueNumber) ?? [];
      const item = {
        id: ++commentSeq,
        user: { login: 'dev-user' },
        created_at: new Date().toISOString(),
        ...comment,
      };
      list.push(item);
      comments.set(issueNumber, list);
      return item;
    },
    getComments(issueNumber) {
      return comments.get(issueNumber) ?? [];
    },
    getAllComments() {
      return Array.from(comments.values()).flat();
    },
  };
}

export function startFakeGithub(port = 0, state = createFakeGithubState()) {
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(body !== undefined ? JSON.stringify(body) : '');
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);

    // Auth check (allow Bearer ...)
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return send(res, 401, { message: 'Bad credentials' });
    }

    if (url.pathname === '/user') {
      return send(res, 200, { login: 'dev-user' });
    }

    const repoMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/);
    if (repoMatch) {
      return send(res, 200, {
        full_name: `${repoMatch[1]}/${repoMatch[2]}`,
        private: false,
      });
    }

    const issuesMatch = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues$/);
    if (issuesMatch && req.method === 'GET') {
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === state.etag) {
        res.writeHead(304);
        res.end();
        return;
      }

      const reqState = url.searchParams.get('state') ?? 'open';
      const reqLabels = url.searchParams.get('labels')?.split(',').map(s => s.trim()).filter(Boolean);
      const reqAssignee = url.searchParams.get('assignee');

      let filtered = state.issues.filter(i => {
        if (reqState !== 'all' && i.state !== reqState) return false;
        if (reqLabels?.length) {
          const have = (i.labels ?? []).map(l => l.name);
          if (!reqLabels.every(l => have.includes(l))) return false;
        }
        if (reqAssignee && i.assignee?.login !== reqAssignee) return false;
        return true;
      });

      const perPage = Number(url.searchParams.get('per_page') ?? 100);
      const page = Number(url.searchParams.get('page') ?? 1);
      const start = (page - 1) * perPage;
      const end = start + perPage;
      const paginated = filtered.slice(start, end);

      const headers = { ETag: state.etag };
      if (end < filtered.length) {
        const nextUrl = new URL(url.toString());
        nextUrl.searchParams.set('page', String(page + 1));
        headers.Link = `<${nextUrl.toString()}>; rel="next"`;
      }

      return send(res, 200, paginated, headers);
    }

    const commentsMatch =
      url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/) ||
      url.pathname.match(/^\/issues\/(\d+)\/comments$/);

    if (commentsMatch) {
      const issueNum = Number(commentsMatch[3] ?? commentsMatch[1]);
      if (req.method === 'GET') {
        return send(res, 200, state.getComments(issueNum));
      }
      if (req.method === 'POST') {
        let raw = '';
        req.on('data', c => (raw += c));
        req.on('end', () => {
          let body = {};
          try {
            body = JSON.parse(raw);
          } catch {}
          const c = state.addComment(issueNum, { body: body.body ?? '' });
          return send(res, 201, c);
        });
        return;
      }
    }

    return send(res, 404, { message: 'Not Found' });
  });

  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () => {
      const assignedPort = server.address().port;
      resolve({
        server,
        port: assignedPort,
        url: `http://127.0.0.1:${assignedPort}`,
        state,
        close: () => new Promise(cb => server.close(cb)),
      });
    });
  });
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('fake-github.mjs')) {
  const port = Number(process.argv[2] ?? process.env.FAKE_GITHUB_PORT ?? 4488);
  startFakeGithub(port).then(({ port }) => {
    console.log(`fake GitHub on http://127.0.0.1:${port}`);
  });
}
