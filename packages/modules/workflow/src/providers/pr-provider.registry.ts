import { Inject, Injectable } from '@nestjs/common';
import type { PrProvider, PrRef, RepoRef } from '@tesserax/contracts';
import { PR_PROVIDERS } from '@tesserax/core';

@Injectable()
export class PrProviderRegistry {
  private readonly providers = new Map<string, PrProvider>();
  private readonly list: PrProvider[];

  constructor(@Inject(PR_PROVIDERS) providers: PrProvider[]) {
    this.list = Array.isArray(providers) ? providers : [];
    for (const p of this.list) {
      this.providers.set(p.kind, p);
    }
  }

  get(kind: string): PrProvider | null {
    return this.providers.get(kind) ?? null;
  }

  all(): PrProvider[] {
    return [...this.list];
  }

  resolve(remoteUrl: string, explicitKind?: string | null): { provider: PrProvider; repo: RepoRef } | null {
    if (explicitKind) {
      const provider = this.get(explicitKind);
      if (!provider) return null;
      let repo = provider.detect(remoteUrl);
      if (!repo) {
        // Fallback for custom git alias when explicitKind is specified, e.g. git@custom-alias:owner/repo.git or https://custom-alias/owner/repo.git
        const gitMatch = remoteUrl.trim().match(/[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
        if (gitMatch) {
          repo = { owner: gitMatch[1]!, repo: gitMatch[2]! };
        }
      }
      return repo ? { provider, repo } : null;
    }
    for (const provider of this.list) {
      const repo = provider.detect(remoteUrl);
      if (repo) return { provider, repo };
    }
    return null;
  }

  parsePrUrl(url: string): { provider: PrProvider; pr: PrRef } | null {
    for (const provider of this.list) {
      const pr = provider.parsePrUrl(url);
      if (pr) return { provider, pr };
    }
    return null;
  }
}
