import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { McpServerDto } from '@tesserax/contracts';
import type { McpStatusProvider } from '../provider';

type ServerCfg = {
  type?: string;
  url?: string;
  command?: string;
  disabled?: boolean;
  env?: Record<string, unknown>;
  envKeys?: string[];
  [key: string]: unknown;
};
type ServerMap = Record<string, ServerCfg | null | undefined>;

const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

function unquote(str: string): string {
  const trimmed = str.trim();
  const quoted = trimmed.match(/^["'](.*?)["']/);
  const matchGroup = quoted?.[1];
  if (matchGroup !== undefined) return matchGroup;
  return trimmed.replace(/#.*$/, '').trim();
}

export function parseCodexToml(content: string): Record<string, ServerCfg> {
  const servers: Record<string, ServerCfg> = {};
  let currentServer: string | null = null;
  let isEnvSection = false;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const headerMatch = line.match(/^\[([^\]]+)\]/);
    if (headerMatch) {
      const rawSection = headerMatch[1];
      if (!rawSection) continue;
      const section = rawSection.trim();
      if (section.startsWith('mcp_servers.')) {
        const sub = section.slice('mcp_servers.'.length).trim();
        if (sub.endsWith('.env')) {
          const namePart = sub.slice(0, -4).trim();
          const serverName = unquote(namePart);
          currentServer = serverName;
          isEnvSection = true;
          servers[serverName] ??= { envKeys: [] };
        } else {
          const serverName = unquote(sub);
          currentServer = serverName;
          isEnvSection = false;
          servers[serverName] ??= { envKeys: [] };
        }
      } else {
        currentServer = null;
        isEnvSection = false;
      }
      continue;
    }

    if (!currentServer) continue;

    const kvMatch = line.match(/^([a-zA-Z0-9_\-.]+)\s*=\s*(.*)$/);
    if (!kvMatch) continue;

    const rawKey = kvMatch[1];
    const rawVal = kvMatch[2];
    if (rawKey === undefined || rawVal === undefined) continue;

    const key = rawKey.trim();
    const val = rawVal.trim();

    const entry = servers[currentServer];
    if (!entry) continue;

    if (isEnvSection) {
      entry.envKeys ??= [];
      if (!entry.envKeys.includes(key)) {
        entry.envKeys.push(key);
      }
    } else {
      if (key === 'command') {
        entry.command = unquote(val);
      } else if (key === 'url') {
        entry.url = unquote(val);
      } else if (key === 'type') {
        entry.type = unquote(val);
      } else if (key === 'disabled') {
        const cleanBool = unquote(val).toLowerCase();
        entry.disabled = cleanBool === 'true';
      } else if (key === 'env') {
        const inlineMatches = val.matchAll(/([a-zA-Z0-9_]+)\s*=/g);
        entry.envKeys ??= [];
        for (const m of inlineMatches) {
          const envName = m[1];
          if (envName && !entry.envKeys.includes(envName)) {
            entry.envKeys.push(envName);
          }
        }
      }
    }
  }

  return servers;
}

/**
 * Built-in provider discovering MCP servers across supported clients:
 * Claude Code, Cursor, Claude Desktop, Gemini CLI, Antigravity, and Codex CLI.
 * Reads names, transports, targets, and env key names only; never reads env values.
 */
export class BuiltinMcpProvider implements McpStatusProvider {
  readonly name = 'builtin';

  constructor(
    private readonly home = homedir(),
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  async list(projectDirs: string[]): Promise<McpServerDto[]> {
    const out: McpServerDto[] = [];
    const uniqueProjectDirs = [...new Set(projectDirs)];

    const short = (p: string) => {
      if (p === this.home) return '~';
      if (p.startsWith(this.home)) {
        const rest = p.slice(this.home.length);
        return rest.startsWith('/') || rest.startsWith('\\') ? '~' + rest : '~/' + rest;
      }
      return p;
    };

    const add = (
      servers: ServerMap | undefined,
      client: string,
      scope: string,
      file: string,
      isOn: (name: string, cfg: ServerCfg) => boolean,
    ) => {
      for (const [name, raw] of Object.entries(servers ?? {})) {
        const cfg = raw ?? {};
        const url = typeof cfg.url === 'string' ? cfg.url : null;
        let target = '';
        if (url) {
          try {
            target = new URL(url).host;
          } catch {
            target = 'url';
          }
        } else if (cfg.command) {
          target = basename(String(cfg.command));
        }
        const envKeys = Array.isArray(cfg.envKeys)
          ? cfg.envKeys
          : Object.keys(cfg.env ?? {});

        out.push({
          id: `${client}|${scope}|${name}`,
          name,
          client,
          scope,
          file,
          transport: url ? cfg.type ?? 'http' : 'stdio',
          target,
          enabled: isOn(name, cfg),
          envKeys,
        });
      }
    };

    // 1. Claude Code (~/.claude.json & <project>/.mcp.json)
    const claudeJson = readJson(join(this.home, '.claude.json')) ?? {};
    add(claudeJson.mcpServers, 'Claude Code', 'user', '~/.claude.json', (n, cfg) => !cfg.disabled);

    const projects: Record<string, any> = claudeJson.projects ?? {};
    const claudeDirs = new Set([...Object.keys(projects), ...uniqueProjectDirs]);
    for (const dir of claudeDirs) {
      const p = projects[dir] ?? {};
      const local = readJson(join(dir, '.claude', 'settings.local.json')) ?? {};
      const disabled = new Set<string>([...(p.disabledMcpjsonServers ?? []), ...(local.disabledMcpjsonServers ?? [])]);
      const enabled = new Set<string>([...(p.enabledMcpjsonServers ?? []), ...(local.enabledMcpjsonServers ?? [])]);
      const allOn = Boolean(p.enableAllProjectMcpServers || local.enableAllProjectMcpServers);

      add(p.mcpServers, 'Claude Code', `local:${short(dir)}`, '~/.claude.json', (n, cfg) => !cfg.disabled);

      const mcpJson = join(dir, '.mcp.json');
      if (existsSync(mcpJson)) {
        add(
          readJson(mcpJson)?.mcpServers,
          'Claude Code',
          `project:${short(dir)}`,
          `${short(dir)}/.mcp.json`,
          (n, cfg) => !cfg.disabled && !disabled.has(n) && (allOn || enabled.has(n)),
        );
      }
    }

    // 2. Cursor (~/.cursor/mcp.json & <project>/.cursor/mcp.json)
    const cursorUserPath = join(this.home, '.cursor', 'mcp.json');
    if (existsSync(cursorUserPath)) {
      add(readJson(cursorUserPath)?.mcpServers, 'Cursor', 'user', '~/.cursor/mcp.json', (n, cfg) => !cfg.disabled);
    }
    for (const dir of uniqueProjectDirs) {
      const cursorProjPath = join(dir, '.cursor', 'mcp.json');
      if (existsSync(cursorProjPath)) {
        add(
          readJson(cursorProjPath)?.mcpServers,
          'Cursor',
          `project:${short(dir)}`,
          `${short(dir)}/.cursor/mcp.json`,
          (n, cfg) => !cfg.disabled,
        );
      }
    }

    // 3. Claude Desktop (OS-dependent user config)
    let desktopPath: string;
    if (this.platform === 'darwin') {
      desktopPath = join(this.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    } else if (this.platform === 'win32') {
      desktopPath = join(this.env.APPDATA || join(this.home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    } else {
      desktopPath = join(this.env.XDG_CONFIG_HOME || join(this.home, '.config'), 'Claude', 'claude_desktop_config.json');
    }
    if (existsSync(desktopPath)) {
      add(readJson(desktopPath)?.mcpServers, 'Claude Desktop', 'user', short(desktopPath), (n, cfg) => !cfg.disabled);
    }

    // 4. Gemini CLI (~/.gemini/settings.json & <project>/.gemini/settings.json)
    const geminiUserPath = join(this.home, '.gemini', 'settings.json');
    if (existsSync(geminiUserPath)) {
      add(readJson(geminiUserPath)?.mcpServers, 'Gemini CLI', 'user', '~/.gemini/settings.json', (n, cfg) => !cfg.disabled);
    }
    for (const dir of uniqueProjectDirs) {
      const geminiProjPath = join(dir, '.gemini', 'settings.json');
      if (existsSync(geminiProjPath)) {
        add(
          readJson(geminiProjPath)?.mcpServers,
          'Gemini CLI',
          `project:${short(dir)}`,
          `${short(dir)}/.gemini/settings.json`,
          (n, cfg) => !cfg.disabled,
        );
      }
    }

    // 5. Antigravity (~/.gemini/antigravity/mcp_config.json)
    const antigravityPath = join(this.home, '.gemini', 'antigravity', 'mcp_config.json');
    if (existsSync(antigravityPath)) {
      add(readJson(antigravityPath)?.mcpServers, 'Antigravity', 'user', '~/.gemini/antigravity/mcp_config.json', (n, cfg) => !cfg.disabled);
    }

    // 6. Codex CLI (~/.codex/config.toml)
    const codexPath = join(this.home, '.codex', 'config.toml');
    if (existsSync(codexPath)) {
      try {
        const content = readFileSync(codexPath, 'utf8');
        const parsed = parseCodexToml(content);
        add(parsed, 'Codex CLI', 'user', '~/.codex/config.toml', (n, cfg) => !cfg.disabled);
      } catch {
        // Skip unreadable or corrupted TOML file
      }
    }

    return out;
  }
}
