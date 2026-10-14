import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { McpServerDto } from '@tesserax/contracts';
import type { McpStatusProvider } from '../provider';

type ServerCfg = { type?: string; url?: string; command?: string; env?: Record<string, unknown> };
type ServerMap = Record<string, ServerCfg | null | undefined>;

const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** Fallback when agent-cockpit is not present: Claude Code only (~/.claude.json and project .mcp.json). */
export class ClaudeConfigMcpProvider implements McpStatusProvider {
  readonly name = 'claude-config';

  constructor(private readonly home = homedir()) {}

  async list(projectDirs: string[]): Promise<McpServerDto[]> {
    const out: McpServerDto[] = [];
    const claudeJson = readJson(join(this.home, '.claude.json')) ?? {};
    const short = (p: string) => p.replace(this.home, '~');
    const add = (servers: ServerMap | undefined, client: string, scope: string, file: string, isOn: (n: string) => boolean) => {
      for (const [name, raw] of Object.entries(servers ?? {})) {
        const cfg = raw ?? {};
        const url = typeof cfg.url === 'string' ? cfg.url : null;
        let target = '';
        if (url) {
          try { target = new URL(url).host; } catch { target = 'url'; }
        } else if (cfg.command) target = basename(String(cfg.command));
        out.push({
          id: `${client}|${scope}|${name}`, name, client, scope, file,
          transport: url ? cfg.type ?? 'http' : 'stdio', target, enabled: isOn(name), envKeys: Object.keys(cfg.env ?? {}),
        });
      }
    };

    add(claudeJson.mcpServers, 'Claude Code', 'user', '~/.claude.json', () => true);
    const projects: Record<string, any> = claudeJson.projects ?? {};
    for (const dir of new Set([...Object.keys(projects), ...projectDirs])) {
      const p = projects[dir] ?? {};
      const local = readJson(join(dir, '.claude/settings.local.json')) ?? {};
      const disabled = new Set<string>([...(p.disabledMcpjsonServers ?? []), ...(local.disabledMcpjsonServers ?? [])]);
      const enabled = new Set<string>([...(p.enabledMcpjsonServers ?? []), ...(local.enabledMcpjsonServers ?? [])]);
      const allOn = Boolean(p.enableAllProjectMcpServers || local.enableAllProjectMcpServers);
      add(p.mcpServers, 'Claude Code', `local:${short(dir)}`, '~/.claude.json', () => true);
      const mcpJson = join(dir, '.mcp.json');
      if (existsSync(mcpJson)) {
        add(readJson(mcpJson)?.mcpServers, 'Claude Code', `project:${short(dir)}`, `${short(dir)}/.mcp.json`,
          n => !disabled.has(n) && (allOn || enabled.has(n)));
      }
    }
    return out;
  }
}
