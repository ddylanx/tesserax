#!/usr/bin/env node
// Diagnoses the Jira credentials in .env without printing them: which account Jira sees, or why it refuses.
//   pnpm jira:check
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const clean = v => (v ?? '').trim().replace(/^["']|["']$/g, '');
let site = clean(process.env.JIRA_BASE_URL);
const email = clean(process.env.JIRA_EMAIL);
const token = clean(process.env.JIRA_API_TOKEN);
if (!site || !email || !token) { console.log('Missing JIRA_BASE_URL, JIRA_EMAIL or JIRA_API_TOKEN in .env'); process.exit(1); }
if (!/^https?:\/\//.test(site)) site = `https://${site}`;
site = site.replace(/^(https?:\/\/[^/]+).*$/, '$1');

const mask = s => (s.length <= 8 ? '***' : `${s.slice(0, 4)}…${s.slice(-2)}`);
console.log(`site:  ${site}`);
console.log(`email: ${email.replace(/^(.).*(@.*)$/, '$1***$2')}`);
console.log(`token: ${token.length} characters, starts ${token.slice(0, 5) === 'ATATT' ? 'with ATATT (Atlassian API token)' : 'with something other than ATATT'}${/\s/.test(token) ? ', CONTAINS WHITESPACE' : ''}`);

const auth = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
async function probe(label, base) {
  const res = await fetch(`${base}/rest/api/3/myself`, { headers: { authorization: auth, accept: 'application/json' } }).catch(e => ({ error: e }));
  if (res.error) return console.log(`${label}: network error ${res.error.cause?.code ?? res.error.message}`);
  const body = await res.text();
  let who = '';
  try { const j = JSON.parse(body); who = j.displayName ? ` as "${j.displayName}"` : ''; } catch {}
  const hdr = ['x-seraph-loginreason', 'www-authenticate', 'x-failure-category', 'x-arequestid'].map(h => res.headers.get(h) ? `${h}=${res.headers.get(h)}` : null).filter(Boolean);
  console.log(`${label}: HTTP ${res.status}${who}${hdr.length ? `  [${hdr.join('; ')}]` : ''}${res.ok ? '' : `  body: ${body.slice(0, 160).replace(/\s+/g, ' ')}`}`);
  return res.ok;
}
const ok = await probe('site   ', site);
if (!ok) {
  const t = await fetch(`${site}/_edge/tenant_info`).then(r => r.json()).catch(() => null);
  if (t?.cloudId) await probe('gateway', `https://api.atlassian.com/ex/jira/${t.cloudId}`);
  else console.log('gateway: no cloudId from /_edge/tenant_info (is the site name right?)');
}
