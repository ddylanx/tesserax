#!/usr/bin/env node
// Diagnoses GitHub credentials without printing the token:
// verifies authentication and repository read access.
//   pnpm github:check [owner/repo]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) {
  process.loadEnvFile(join(root, '.env'));
}

const clean = v => (v ?? '').trim().replace(/^["']|["']$/g, '');

let token = clean(process.env.GITHUB_TOKEN);
let tokenSource = 'env';

if (!token) {
  try {
    const stdout = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000 });
    token = stdout.trim();
    if (token) {
      tokenSource = 'gh';
    }
  } catch {
    // gh not available or not logged in
  }
}

if (!token) {
  console.log('No GitHub token found.');
  console.log('Set GITHUB_TOKEN in .env or authenticate via `gh auth login`.');
  process.exit(1);
}

const maskedToken = token.length > 4 ? `***${token.slice(-4)}` : '****';
console.log(`token source: ${tokenSource} (${maskedToken})`);

const repo = process.env.GITHUB_CHECK_REPO || process.argv[2] || '';
const base = clean(process.env.GITHUB_API_URL) || 'https://api.github.com';
console.log(`api base:     ${base}`);
if (repo) {
  console.log(`target repo:  ${repo}`);
} else {
  console.log(`target repo:  (not specified)`);
}

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  Authorization: `Bearer ${token}`,
};

async function probe(label, url) {
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    const err = e.cause?.code ?? e.message;
    console.log(`${label}: network error (${err})`);
    return false;
  }

  const remaining = res.headers.get('x-ratelimit-remaining');
  const limit = res.headers.get('x-ratelimit-limit');
  const resetSec = res.headers.get('x-ratelimit-reset');
  const resetTime = resetSec ? new Date(Number(resetSec) * 1000).toLocaleTimeString() : null;

  let info = '';
  const bodyText = await res.text().catch(() => '');
  try {
    const json = JSON.parse(bodyText);
    if (res.ok) {
      if (json.login) info = ` (user: ${json.login})`;
      else if (json.full_name) info = ` (${json.full_name}, ${json.private ? 'private' : 'public'})`;
    } else {
      info = ` [${json.message || bodyText.slice(0, 120)}]`;
    }
  } catch {
    if (!res.ok) info = ` [${bodyText.slice(0, 120)}]`;
  }

  const rateInfo = remaining !== null ? ` | rate-limit: ${remaining}/${limit}${resetTime ? ` (resets ${resetTime})` : ''}` : '';
  console.log(`${label}: HTTP ${res.status}${info}${rateInfo}`);

  if (res.status === 401) {
    console.log(`  -> Token was rejected by GitHub (401 Bad credentials). Check token validity or scopes.`);
  } else if (res.status === 403 || res.status === 429) {
    if (remaining === '0') {
      console.log(`  -> Rate limit reached. Resets at ${resetTime ?? 'unknown'}.`);
    } else {
      console.log(`  -> Access forbidden (403). Token may lack necessary permissions.`);
    }
  } else if (res.status === 404) {
    console.log(`  -> Not found (404). Check if the repository "${repo}" exists and whether your account has read access.`);
  }

  return res.ok;
}

await probe('user check', `${base}/user`);
if (repo) {
  await probe('repo check', `${base}/repos/${repo}`);
} else {
  console.log('repo check:   skipped (no repo specified; pass owner/repo as an argument or set GITHUB_CHECK_REPO)');
}

console.log('');
console.log('Note: Write access to issues cannot be confirmed from the token alone');
console.log('      (fine-grained tokens are not tested by creating comments).');
console.log('      Ensure your token has "Issues: Read and write" permission.');
