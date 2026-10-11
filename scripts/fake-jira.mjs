#!/usr/bin/env node
// A tiny fake Jira Cloud for local testing without tokens. Serves fixtures/jira/issues.json.
//   node scripts/fake-jira.mjs [port]      (default 4499)
// Then run the api with JIRA_BASE_URL=http://127.0.0.1:4499 JIRA_EMAIL=dev@example.com JIRA_API_TOKEN=fake
// Comments posted to it are printed and kept in memory (GET /_comments lists them).
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 4499);
const issues = () => JSON.parse(readFileSync(join(root, 'fixtures/jira/issues.json'), 'utf8'));
const posted = [];

const pick = (issue, fields) => ({ id: issue.id, key: issue.key, fields: Object.fromEntries(Object.entries(issue.fields).filter(([k]) => !fields || fields.includes(k))) });
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (!req.headers.authorization?.startsWith('Basic ')) return send(res, 401, { error: 'auth' });
  const fields = url.searchParams.get('fields')?.split(',');
  if (url.pathname === '/rest/api/3/myself') return send(res, 200, { accountId: 'dev', displayName: 'Dev' });
  if (url.pathname === '/rest/api/3/field') return send(res, 200, []);
  if (url.pathname === '/rest/api/3/search/jql') {
    const searchFields = fields?.filter(f => f !== 'comment' && f !== 'attachment');
    return send(res, 200, { issues: issues().map(i => pick(i, searchFields)), isLast: true });
  }
  if (url.pathname === '/_comments') return send(res, 200, posted);
  const m = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)(\/comment)?$/);
  if (m) {
    const issue = issues().find(i => i.key === decodeURIComponent(m[1]) || i.id === m[1]);
    if (!issue) return send(res, 404, { errorMessages: ['Issue does not exist'] });
    if (m[2] && req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        const c = { id: String(posted.length + 1), issue: issue.key, body: JSON.parse(body).body };
        posted.push(c);
        console.log(`[fake-jira] comment on ${issue.key}:`, JSON.stringify(c.body).slice(0, 300));
        send(res, 201, { id: c.id });
      });
      return;
    }
    return send(res, 200, pick(issue, fields));
  }
  send(res, 404, { errorMessages: ['not found'] });
}).listen(port, '127.0.0.1', () => console.log(`fake Jira on http://127.0.0.1:${port}`));
