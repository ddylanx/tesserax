import type { Server } from 'node:http';

export interface FakeGithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: { name: string }[];
  assignee: { login: string } | null;
  milestone: { title: string } | null;
  user: { login: string } | null;
  pull_request?: unknown;
}

export interface FakeGithubComment {
  id: number;
  user: { login: string };
  created_at: string;
  body: string;
}

export interface FakeGithubState {
  readonly issues: FakeGithubIssue[];
  readonly etag: string;
  bumpVersion(): void;
  closeIssue(number: number): void;
  removeLabel(number: number, labelName: string): void;
  updateBody(number: number, newBody: string): void;
  addIssue(issue: FakeGithubIssue): void;
  addComment(issueNumber: number, comment: { body: string; [key: string]: unknown }): FakeGithubComment;
  getComments(issueNumber: number): FakeGithubComment[];
  getAllComments(): FakeGithubComment[];
}

export interface FakeGithubServer {
  server: Server;
  port: number;
  url: string;
  state: FakeGithubState;
  close(): Promise<void>;
}

export function createFakeGithubState(initialIssues?: FakeGithubIssue[] | null): FakeGithubState;
export function startFakeGithub(port?: number, state?: FakeGithubState): Promise<FakeGithubServer>;
