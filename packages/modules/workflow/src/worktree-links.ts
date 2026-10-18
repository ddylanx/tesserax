import { existsSync, lstatSync, mkdirSync, readlinkSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, normalize, relative, resolve } from 'node:path';
import { createLogger } from '@tesserax/core';
import { FatalNodeError } from './executors/types';

const log = createLogger('workflow.vcs.links');

export interface LinkWorktreeOptions {
  repoPath: string;
  worktreePath: string;
  linksRaw?: string | null;
  logger?: { warn: (msg: string, extra?: Record<string, unknown>) => void };
}

export function parseWorktreeLinks(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function getProjectInfo(vars: unknown): { name?: string; vars?: Record<string, string> } {
  if (!vars) return {};
  let obj = vars;
  if (typeof vars === 'string') {
    try {
      obj = JSON.parse(vars);
    } catch {
      return {};
    }
  }
  return (obj as { project?: { name?: string; vars?: Record<string, string> } })?.project ?? {};
}

export function getProjectVars(vars: unknown): Record<string, string> {
  return getProjectInfo(vars).vars ?? {};
}

export function ensureWorktreeLinks({ repoPath, worktreePath, linksRaw, logger = log }: LinkWorktreeOptions): void {
  const entries = parseWorktreeLinks(linksRaw);
  if (!entries.length) return;

  for (const rel of entries) {
    const trimmed = rel.replace(/[/\\]+$/, '');
    if (!trimmed || isAbsolute(rel) || rel.includes('\0') || normalize(trimmed) === '.' || normalize(trimmed) === '..') {
      throw new FatalNodeError(`Invalid worktree_links entry "${rel}": path must be relative. Fix it on the project page.`);
    }

    const sourceAbs = resolve(repoPath, trimmed);
    const targetAbs = resolve(worktreePath, trimmed);

    // Path traversal security check
    const relFromRepo = relative(repoPath, sourceAbs);
    const relFromWorktree = relative(worktreePath, targetAbs);
    if (!relFromRepo || !relFromWorktree || relFromRepo.startsWith('..') || relFromWorktree.startsWith('..')) {
      throw new FatalNodeError(`Invalid worktree_links entry "${rel}": path leaves the repository. Fix it on the project page.`);
    }

    if (!existsSync(sourceAbs)) {
      logger.warn(`Source link does not exist, skipping: ${sourceAbs}`, { rel, repoPath });
      continue;
    }

    // Check existing target in worktree
    let stat;
    try {
      stat = lstatSync(targetAbs);
    } catch {
      stat = null;
    }

    if (stat) {
      if (stat.isSymbolicLink()) {
        try {
          const currentTarget = resolve(dirname(targetAbs), readlinkSync(targetAbs));
          if (currentTarget === sourceAbs) {
            continue; // Already correctly linked
          }
        } catch {
          // Dangling or unreadable symlink -> replace
        }
        unlinkSync(targetAbs);
      } else {
        logger.warn(`Target path already exists and is not a symlink, skipping: ${targetAbs}`, { rel });
        continue;
      }
    }

    mkdirSync(dirname(targetAbs), { recursive: true });
    const isDir = statSync(sourceAbs).isDirectory();
    symlinkSync(sourceAbs, targetAbs, isDir ? 'dir' : 'file');
  }
}
