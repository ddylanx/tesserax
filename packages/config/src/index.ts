import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/** Walks up from `start` to the folder holding pnpm-workspace.yaml. */
export function findRepoRoot(start = __dirname): string {
  let dir = start;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

const optional = z
  .string()
  .optional()
  .transform(v => (v && v.trim() !== '' ? v.trim() : undefined));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().default(4400),
  WEB_PORT: z.coerce.number().int().default(5180),
  DATABASE_URL: z.string().url().default('postgres://ot:ot@127.0.0.1:54329/open_tesseract'),

  /** https://your-site.atlassian.net, or just your-site.atlassian.net (https:// is added). */
  JIRA_BASE_URL: optional
    .transform(v => (v ? (/^https?:\/\//i.test(v) ? v : `https://${v}`).replace(/\/+$/, '') : v))
    .pipe(z.string().url().optional()),
  JIRA_EMAIL: optional,
  JIRA_API_TOKEN: optional,
  JIRA_JQL: optional,
  JIRA_WORKSPACE: z.enum(['personal', 'company']).default('company'),

  /** Bitbucket Cloud: an Atlassian API token with Bitbucket scopes (read:repository, write:pullrequest). Email defaults to JIRA_EMAIL. */
  BITBUCKET_EMAIL: optional,
  BITBUCKET_API_TOKEN: optional,
  BITBUCKET_API_URL: z.string().default('https://api.bitbucket.org/2.0'),

  /** Claude Code CLI used for classification and playbook runs. */
  CLAUDE_BIN: z.string().default('claude'),
  /** Gemini CLI, an alternative engine for AI steps and agent runs. */
  GEMINI_BIN: z.string().default('gemini'),
  /** Antigravity CLI (`agy`), another engine for AI steps and agent runs. */
  ANTIGRAVITY_BIN: z.string().default(join(homedir(), '.local', 'bin', 'agy')),
  /** What a new Jira issue starts: the node workflow (default), the older pipeline, or nothing. */
  AUTO_START: z.enum(['workflow', 'pipeline', 'off']).default('workflow'),
  /** claude-cli (default; falls back to rules on any failure) | rules */
  CLASSIFIER_ENGINE: z.enum(['claude-cli', 'rules']).default('claude-cli'),
  /** Model alias for classification (empty: the CLI's default). */
  CLASSIFIER_MODEL: optional,
  /** Model alias for playbook runs (empty: the CLI's default). */
  PLAYBOOK_MODEL: optional,
  /** Runtime data (worktrees, run logs). Default <repo>/.data */
  OT_DATA_DIR: optional,
  /** Max seconds for one headless playbook run. */
  PLAYBOOK_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(1800),
  /** Base URL of the web app, for links in notifications. */
  WEB_BASE_URL: z.string().default('http://127.0.0.1:5180'),

  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_ALLOWED_USER_IDS: optional.transform(v =>
    (v ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite),
  ),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/** Loads <repo>/.env (if present) into process.env once, then validates. Real env vars win. */
export function loadConfig(): AppConfig {
  if (cached) return cached;
  const envFile = join(findRepoRoot(), '.env');
  if (existsSync(envFile)) {
    const before = { ...process.env };
    process.loadEnvFile(envFile);
    Object.assign(process.env, before);
  }
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}

export const jiraConfigured = (c: AppConfig) => Boolean(c.JIRA_BASE_URL && c.JIRA_EMAIL && c.JIRA_API_TOKEN);

/** Runtime data: worktrees and run logs (gitignored). */
export const dataDir = (c: AppConfig) => c.OT_DATA_DIR ?? join(findRepoRoot(), '.data');
