import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CONTEXT_LIMITS, type Role } from '@tesserax/contracts';
import type { TeamContextPackRow, TeamImprovementRow } from '@tesserax/db';
import type { ContextRepo } from './context.repo';
import { ContextService } from './context.service';

function memoryRepo() {
  const packs: TeamContextPackRow[] = [];
  const improvements: TeamImprovementRow[] = [];
  let tick = 0;
  const repo: ContextRepo = {
    packs: async () => [...packs].sort((a, b) => a.position - b.position),
    savePack: async (slug, v) => {
      const current = packs.find(p => p.slug === slug);
      if (current) return Object.assign(current, v, { updated_at: new Date() });
      const row = { id: randomUUID(), slug, created_at: new Date(), updated_at: new Date(), ...v };
      packs.push(row);
      return row;
    },
    deletePack: async slug => void packs.splice(0, packs.length, ...packs.filter(p => p.slug !== slug)),
    improvements: async (f = {}) =>
      improvements.filter(i => (!f.roleId || i.role_id === f.roleId) && (!f.status || i.status === f.status)).sort((a, b) => +b.created_at - +a.created_at),
    improvement: async id => improvements.find(i => i.id === id),
    insertImprovement: async v => {
      const row = { id: randomUUID(), status: 'proposed', note: '', created_at: new Date(Date.now() + tick++), decided_at: null, ...v };
      improvements.push(row);
      return row;
    },
    updateImprovement: async (id, v) => {
      const row = improvements.find(i => i.id === id);
      return row ? Object.assign(row, v) : undefined;
    },
  };
  return repo;
}

const role = (key: string, prompt = 'You are a DEMO role.'): Role => ({
  id: randomUUID(), key, departmentId: 'd', slug: key.split('/')[1]!, title: key, enabled: true, prompt, config: { skills: [] }, position: 0, hash: 'h', problems: [], usedBy: [],
});

function setup() {
  const roles = [role('eng/dev'), role('eng/review')];
  const team = {
    getByKey: async (key: string) => roles.find(r => r.key === key) ?? null,
    keys: async () => roles.map(r => r.key),
    getRole: async (id: string) => roles.find(r => r.id === id)!,
    list: async () => ({ departments: [], roles }),
    updateRole: async (id: string, body: unknown) => Object.assign(roles.find(r => r.id === id)!, body),
  };
  const svc = new ContextService(memoryRepo(), team);
  return { svc, dev: roles[0]!, review: roles[1]! };
}

const pack = (over: Record<string, unknown> = {}) => ({ name: 'Pack', body: 'DEMO body', ...over });

test('a role sees pinned packs always, switched packs when on, and never a pack outside its audience', async () => {
  const { svc, dev, review } = setup();
  await svc.savePack('shared', pack({ name: 'Shared memory', pinned: true }));
  await svc.savePack('tech', pack({ name: 'Tech notes', body: 'DEMO stack: Node', source: 'docs/tech.md' }));
  await svc.savePack('money', pack({ name: 'Money', audience: ['eng/review'] }));

  let o = await svc.overview();
  const of = (key: string) => o.roles.find(r => r.key === key)!;
  assert.deepEqual(of('eng/dev').using, ['shared']);
  assert.deepEqual(of('eng/dev').available, ['tech']);
  assert.deepEqual(of('eng/dev').blocked, ['money']);
  assert.deepEqual(of('eng/review').available, ['tech', 'money']);

  await assert.rejects(svc.setRoleContext(dev.id, { packs: ['money'] }), /outside the audience/);
  await assert.rejects(svc.setRoleContext(dev.id, { packs: ['nope'] }), /No such context pack/);
  const after = await svc.setRoleContext(dev.id, { packs: ['tech', 'shared'] });
  assert.deepEqual(after.using, ['shared', 'tech']);
  assert.deepEqual((dev.config as { context: string[] }).context, ['tech'], 'a pinned pack needs no switch');

  const text = (await svc.getByKey('eng/dev'))!.contextText!;
  assert.match(text, /## Context: Shared memory/);
  assert.match(text, /DEMO stack: Node\n\nSource: docs\/tech\.md/);
  assert.doesNotMatch(text, /Money/, 'a blocked pack is not even named');
  assert.match((await svc.getByKey('eng/review'))!.contextText!, /Context you were not given: Tech notes \(`tech`\), Money \(`money`\)/);

  // narrowing the audience later leaves a stale switch, which the page shows
  await svc.savePack('tech', pack({ name: 'Tech notes', audience: ['eng/review'] }));
  o = await svc.overview();
  assert.deepEqual(of('eng/dev').stale, ['tech']);
  assert.deepEqual(of('eng/dev').using, ['shared']);
  assert.equal(review.config.context, undefined);
});

test('the size of what a role reads is capped; secrets are refused', async () => {
  const { svc, dev } = setup();
  const big = 'x'.repeat(CONTEXT_LIMITS.body);
  for (const slug of ['a', 'b', 'c', 'd']) await svc.savePack(slug, pack({ name: slug, body: big }));
  await svc.setRoleContext(dev.id, { packs: ['a', 'b'] });
  await assert.rejects(svc.setRoleContext(dev.id, { packs: ['a', 'b', 'c', 'd'] }), /over the limit/);
  const r = (await svc.overview()).roles.find(x => x.key === 'eng/dev')!;
  assert.equal(r.overLimit, false);
  assert.ok(r.chars.context > 2 * CONTEXT_LIMITS.body && r.chars.limit === CONTEXT_LIMITS.roleChars);
  await assert.rejects(svc.savePack('k', pack({ body: `token ghp_${'a'.repeat(36)}` })), /secrets/);
  await assert.rejects(svc.savePack('Bad Slug', pack()), /./);
});

test('a role proposes, the owner decides: approved lessons join its context, rejected ones are not proposed twice', async () => {
  const { svc, dev } = setup();
  const lesson = (text: string, reason = '') => ({ kind: 'lesson' as const, text, reason, pack: null });
  assert.equal(await svc.proposeImprovements('eng/dev', [lesson('Run the DEMO tests before reporting', 'sent back: tests failed'), lesson('Ask before renaming a public field')], 'run:1:build'), 2);
  assert.equal(await svc.proposeImprovements('eng/dev', [lesson('run the demo tests before reporting.')], 'run:2:build'), 0, 'same proposal, other wording');
  assert.equal(await svc.proposeImprovements('eng/none', [lesson('whatever it is')], 'run:2:build'), 0);

  let list = await svc.improvements({ status: 'proposed' });
  assert.equal(list.length, 2);
  assert.equal((await svc.getByKey('eng/dev'))!.contextText, '', 'a proposal changes nothing until a person approves it');
  const [ask, tests] = list;
  assert.equal(tests!.source, 'run:1:build');

  const approved = await svc.decide(tests!.id, { decision: 'approve', text: 'Run the DEMO test suite before you report' });
  assert.equal(approved.status, 'approved');
  await svc.decide(ask!.id, { decision: 'reject', note: 'too slow for small fixes' });
  const text = (await svc.getByKey('eng/dev'))!.contextText!;
  assert.match(text, /## Lessons for this role[^\n]*\n- Run the DEMO test suite before you report/);
  assert.match(text, /turned down[^\n]*\n- Ask before renaming a public field \(owner: too slow for small fixes\)/);
  assert.equal(await svc.proposeImprovements('eng/dev', [lesson('Ask before renaming a public field')], 'run:3:build'), 0, 'rejected: not proposed again');

  const o = (await svc.overview()).roles.find(r => r.key === 'eng/dev')!;
  assert.deepEqual([o.lessons, o.pendingProposals], [1, 0]);

  await assert.rejects(svc.decide(ask!.id, { decision: 'retire' }), /Cannot retire/);
  await svc.decide(tests!.id, { decision: 'retire' });
  assert.doesNotMatch((await svc.getByKey('eng/dev'))!.contextText!, /Lessons for this role/);
  list = await svc.improvements({ role: 'eng/dev' });
  assert.deepEqual(list.map(i => i.status).sort(), ['rejected', 'retired']);
  assert.equal(dev.config.context, undefined);
});

test('a context request switches the pack on when approved, inside the audience only', async () => {
  const { svc, dev } = setup();
  await svc.savePack('tech', pack({ name: 'Tech notes' }));
  await svc.savePack('money', pack({ name: 'Money', audience: ['eng/review'] }));
  const ask = (slug: string) => ({ kind: 'context' as const, text: 'needed for the task', reason: '', pack: slug });
  assert.equal(await svc.proposeImprovements('eng/dev', [ask('tech'), ask('tech'), ask('money')], 'run:1:plan'), 2, 'a pack is asked for once');
  assert.equal(await svc.proposeImprovements('eng/dev', [ask('nope')], 'run:1:plan'), 0, 'no such pack');
  const list = await svc.improvements({ status: 'proposed' });
  const tech = list.find(i => i.pack === 'tech')!;
  const money = list.find(i => i.pack === 'money')!;
  await svc.decide(tech.id, { decision: 'approve' });
  assert.deepEqual((dev.config as { context: string[] }).context, ['tech']);
  await assert.rejects(svc.decide(money.id, { decision: 'approve' }), /outside the audience/);
  await assert.rejects(svc.propose(dev.id, ask('tech')), /already reads tech/);
  await assert.rejects(svc.propose(dev.id, { kind: 'context', text: 'needs it' }), /names the pack/);
});

test('proposals waiting and lessons kept are both capped per role', async () => {
  const { svc, dev } = setup();
  for (let i = 0; i < CONTEXT_LIMITS.pendingPerRole; i++) await svc.propose(dev.id, { text: `DEMO rule number ${i}` });
  await assert.rejects(svc.propose(dev.id, { text: 'one more DEMO rule' }), /proposals waiting/);
});
