import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mapIssue, mapComments } from './map';
import type { GithubIssue, GithubComment } from './client';

test('mapIssue maps all fields correctly from a complete GitHub issue', () => {
  const issue: GithubIssue = {
    number: 123,
    title: 'Add GitHub sync',
    body: '## Details\nSome markdown description',
    state: 'open',
    html_url: 'https://github.com/owner/repo/issues/123',
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-02T15:30:00Z',
    labels: [{ name: 'feature' }, { name: 'tesserax' }],
    assignee: { login: 'octocat' },
    milestone: { title: 'Sprint 42' },
    user: { login: 'creator' },
  };

  const mapped = mapIssue(issue, 'owner/repo');

  assert.equal(mapped.key, '#123');
  assert.equal(mapped.project, 'owner/repo');
  assert.equal(mapped.external_id, 'owner/repo#123');
  assert.equal(mapped.title, 'Add GitHub sync');
  assert.equal(mapped.description, '## Details\nSome markdown description');
  assert.deepEqual(mapped.labels, ['feature', 'tesserax']);
  assert.equal(mapped.assignee, 'octocat');
  assert.equal(mapped.reporter, 'creator');
  assert.equal(mapped.sprint, 'Sprint 42');
  assert.equal(mapped.url, 'https://github.com/owner/repo/issues/123');
  assert.equal(mapped.status, 'open');
  assert.equal(mapped.status_category, 'todo');
  assert.equal(mapped.type, 'Issue');
  assert.equal(mapped.created_at_source, '2026-10-01T12:00:00Z');
  assert.equal(mapped.updated_at_source, '2026-10-02T15:30:00Z');
});

test('mapIssue handles null body, null assignee, null milestone, and closed state', () => {
  const issue: GithubIssue = {
    number: 456,
    title: 'Bug report without details',
    body: null,
    state: 'closed',
    html_url: 'https://github.com/owner/repo/issues/456',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    labels: [],
    assignee: null,
    milestone: null,
    user: null,
  };

  const mapped = mapIssue(issue, 'owner/repo');

  assert.equal(mapped.key, '#456');
  assert.equal(mapped.external_id, 'owner/repo#456');
  assert.equal(mapped.description, null);
  assert.equal(mapped.assignee, null);
  assert.equal(mapped.reporter, null);
  assert.equal(mapped.sprint, null);
  assert.equal(mapped.status, 'closed');
  assert.equal(mapped.status_category, 'done');
});

test('mapComments formats comments to author, created, body shape', () => {
  const raw: GithubComment[] = [
    { id: 1, user: { login: 'alice' }, created_at: '2026-10-01T10:00:00Z', body: 'Comment 1' },
    { id: 2, user: null, created_at: '2026-10-01T11:00:00Z', body: 'Anonymous comment' },
  ];

  const mapped = mapComments(raw);

  assert.equal(mapped.length, 2);
  assert.deepEqual(mapped[0], { author: 'alice', created: '2026-10-01T10:00:00Z', body: 'Comment 1' });
  assert.deepEqual(mapped[1], { author: null, created: '2026-10-01T11:00:00Z', body: 'Anonymous comment' });
});
