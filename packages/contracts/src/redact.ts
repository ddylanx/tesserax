/**
 * Secrets in text that leaves the api (step logs, artifacts, Telegram). The token patterns are the same as the ones that
 * keep secrets out of Team roles (`containsSecret`).
 */
export const SECRET_TOKEN_PATTERNS: readonly string[] = [
  'ghp_[A-Za-z0-9]+',
  'github_pat_[A-Za-z0-9_]*',
  '\\bsk-[A-Za-z0-9_-]{8,}',
  'xox[abp]-[A-Za-z0-9-]*',
  'AKIA[0-9A-Z]{16}',
  '-----BEGIN[\\s\\S]*?(?:-----END[^\\n]*-----|$)',
];

/** Environment variables whose values are secrets (only values longer than 12 characters are replaced). */
export const SECRET_ENV_KEY = /TOKEN|SECRET|KEY|PASSWORD|DATABASE_URL/i;

export function containsSecretToken(text: string): boolean {
  return SECRET_TOKEN_PATTERNS.some(p => new RegExp(p).test(text));
}

/**
 * Replaces secret values from `env` with «redacted:<KEY>» and token-shaped strings with «redacted:token».
 * Pass process.env on the server; normal text comes back unchanged.
 */
export function redact(text: string, env: Record<string, string | undefined> = {}): string {
  if (!text) return text;
  let out = text;
  const values = Object.entries(env)
    .filter((e): e is [string, string] => SECRET_ENV_KEY.test(e[0]) && typeof e[1] === 'string' && e[1].length > 12)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [key, value] of values) out = out.split(value).join(`«redacted:${key}»`);
  for (const p of SECRET_TOKEN_PATTERNS) out = out.replace(new RegExp(p, 'g'), '«redacted:token»');
  return out;
}
