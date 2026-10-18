import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@tesserax/config';
import type { CreatedPr, CreatePrInput, PrCommentResult, PrProvider, PrRef, RepoRef } from '@tesserax/contracts';
import { CONFIG } from '@tesserax/core';
import {
  BitbucketClient,
  commentOnPr,
  findOpenPr,
  parseBitbucketRemote,
  parsePrUrl as parseBbPrUrl,
} from '../bitbucket';

@Injectable()
export class BitbucketPrProvider implements PrProvider {
  readonly kind = 'bitbucket';

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  detect(remoteUrl: string): RepoRef | null {
    const trimmed = remoteUrl.trim();
    const direct = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (direct) return { owner: direct[1]!, repo: direct[2]! };
    const parsed = parseBitbucketRemote(trimmed);
    return parsed ? { owner: parsed.workspace, repo: parsed.slug } : null;
  }

  parsePrUrl(url: string): PrRef | null {
    const parsed = parseBbPrUrl(url);
    return parsed ? { owner: parsed.workspace, repo: parsed.slug, id: parsed.id, url: parsed.url } : null;
  }

  async findOpenPr(repo: RepoRef, branch: string): Promise<PrRef | null> {
    const client = this.client();
    const pr = await findOpenPr(client, repo.owner, repo.repo, branch);
    return pr ? { owner: pr.workspace, repo: pr.slug, id: pr.id, url: pr.url } : null;
  }

  async createPr(repo: RepoRef, input: CreatePrInput): Promise<CreatedPr> {
    const client = this.client();
    const pr = await client.openPullRequest({
      workspace: repo.owner,
      slug: repo.repo,
      title: input.title,
      description: input.body,
      source: input.source,
      destination: input.target,
    });
    return {
      owner: repo.owner,
      repo: repo.repo,
      id: pr.id,
      url: pr.url,
      existing: pr.existing,
    };
  }

  async comment(pr: PrRef, markdown: string): Promise<PrCommentResult> {
    const client = this.client();
    const result = await commentOnPr(
      client,
      { workspace: pr.owner, slug: pr.repo, id: Number(pr.id), url: pr.url },
      markdown,
    );
    return { id: result.id };
  }

  private client(): BitbucketClient {
    const email = this.config.BITBUCKET_EMAIL ?? this.config.JIRA_EMAIL;
    if (!this.config.BITBUCKET_API_TOKEN || !email) {
      throw new Error('Bitbucket is not configured: set BITBUCKET_API_TOKEN (and BITBUCKET_EMAIL if it differs from JIRA_EMAIL) in .env.');
    }
    return new BitbucketClient(
      {
        baseUrl: this.config.BITBUCKET_API_URL,
        email,
        token: this.config.BITBUCKET_API_TOKEN,
      },
      this.fetchFn,
    );
  }
}
