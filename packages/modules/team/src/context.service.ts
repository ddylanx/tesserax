import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  CONTEXT_LIMITS, contextText, decideImprovementSchema, improvementFingerprint, proposeImprovementSchema, resolveContext, saveContextPackSchema,
  setRoleContextSchema, switchedOnPacks, teamSlugSchema,
  type ContextOverview, type ContextPack, type Improvement, type ImprovementKind, type ImprovementStatus, type ProposeImprovement,
  type ProposedImprovement, type Role, type RoleContext, type RoleContextText, type RoleLookup,
} from '@tesserax/contracts';
import { createLogger } from '@tesserax/core';
import type { TeamContextPackRow, TeamImprovementRow } from '@tesserax/db';
import type { ContextRepo } from './context.repo';
import type { TeamService } from './team.service';

const log = createLogger('team.context');

const bad = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  new BadRequestException(e.issues.map(i => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '));

const toPack = (r: TeamContextPackRow): ContextPack => ({
  id: r.id, slug: r.slug, name: r.name, description: r.description, body: r.body, source: r.source,
  audience: Array.isArray(r.audience) ? r.audience.filter((k): k is string => typeof k === 'string') : null,
  pinned: r.pinned, position: r.position, chars: r.body.length, updatedAt: new Date(r.updated_at).toISOString(),
});

const toImprovement = (r: TeamImprovementRow): Improvement => ({
  id: r.id, roleId: r.role_id, roleKey: r.role_key, kind: r.kind as ImprovementKind, text: r.text, reason: r.reason, pack: r.pack, source: r.source,
  status: r.status as ImprovementStatus, note: r.note, createdAt: new Date(r.created_at).toISOString(),
  decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
});

/** A context request is the same request whatever its wording. */
const fingerprintOf = (v: Pick<ProposedImprovement, 'kind' | 'text' | 'pack'>) => (v.kind === 'context' ? `context:${v.pack}` : improvementFingerprint(v.text));

type TeamPort = Pick<TeamService, 'getByKey' | 'keys' | 'getRole' | 'list' | 'updateRole'>;

/**
 * Context page: what each role reads besides its own prompt (packs, switched per role inside the pack's audience) and how a
 * role gets better at its job (it proposes, a person decides, approved lessons join its context). Also the ROLE_LOOKUP the
 * workflow engine uses: a role by key comes with its context text.
 */
export class ContextService implements RoleLookup {
  constructor(
    private readonly repo: ContextRepo,
    private readonly team: TeamPort,
  ) {}

  // ---------- role lookup (workflow engine) ----------

  async getByKey(key: string): Promise<Role | null> {
    const role = await this.team.getByKey(key);
    if (!role) return null;
    const [packs, improvements] = await Promise.all([this.packs(), this.repo.improvements({ roleId: role.id })]);
    return { ...role, contextText: this.textFor(role, packs, improvements) };
  }

  keys(): Promise<string[]> {
    return this.team.keys();
  }

  private async packs(): Promise<ContextPack[]> {
    return (await this.repo.packs()).map(toPack);
  }

  private textFor(role: Pick<Role, 'key' | 'config'>, packs: ContextPack[], improvements: TeamImprovementRow[]): string {
    const r = resolveContext(packs, role.key, switchedOnPacks(role.config));
    const lessons = improvements.filter(i => i.kind === 'lesson');
    return contextText(r.using, r.available, {
      // oldest first, so the list a role reads only grows at the end
      approved: lessons.filter(i => i.status === 'approved').reverse().map(i => i.text),
      rejected: lessons.filter(i => i.status === 'rejected').slice(0, CONTEXT_LIMITS.rejectedShown).map(i => ({ text: i.text, note: i.note })),
    });
  }

  // ---------- overview ----------

  async overview(): Promise<ContextOverview> {
    const [packs, { roles }, improvements] = await Promise.all([this.packs(), this.team.list(), this.repo.improvements()]);
    return {
      limits: { body: CONTEXT_LIMITS.body, roleChars: CONTEXT_LIMITS.roleChars, packs: CONTEXT_LIMITS.packs, lessonsPerRole: CONTEXT_LIMITS.lessonsPerRole },
      packs,
      roles: roles.map(role => this.roleContext(role, packs, improvements.filter(i => i.role_id === role.id))),
    };
  }

  /** What the role reads and the exact text its steps are sent (the Context page shows it as is). */
  async roleText(roleId: string): Promise<RoleContextText> {
    const role = await this.team.getRole(roleId);
    const [packs, improvements] = await Promise.all([this.packs(), this.repo.improvements({ roleId })]);
    return { role: this.roleContext(role, packs, improvements), text: this.textFor(role, packs, improvements) };
  }

  private roleContext(role: Role, packs: ContextPack[], improvements: TeamImprovementRow[]): RoleContext {
    const r = resolveContext(packs, role.key, switchedOnPacks(role.config));
    const context = this.textFor(role, packs, improvements).length;
    const slugs = (list: ContextPack[]) => list.map(p => p.slug);
    return {
      roleId: role.id, key: role.key, title: role.title, departmentId: role.departmentId, enabled: role.enabled,
      lessons: improvements.filter(i => i.kind === 'lesson' && i.status === 'approved').length,
      pendingProposals: improvements.filter(i => i.status === 'proposed').length,
      using: slugs(r.using), pinned: slugs(r.pinned), available: slugs(r.available), blocked: slugs(r.blocked), stale: r.stale,
      chars: { prompt: role.prompt.length, context, limit: CONTEXT_LIMITS.roleChars },
      overLimit: role.prompt.length + context > CONTEXT_LIMITS.roleChars,
    };
  }

  // ---------- packs ----------

  async savePack(slug: string, body: unknown): Promise<ContextPack> {
    const s = teamSlugSchema.safeParse(slug);
    if (!s.success) throw bad(s.error);
    const parsed = saveContextPackSchema.safeParse(body);
    if (!parsed.success) throw bad(parsed.error);
    const packs = await this.repo.packs();
    const current = packs.find(p => p.slug === s.data);
    if (!current && packs.length >= CONTEXT_LIMITS.packs) throw new ConflictException(`At most ${CONTEXT_LIMITS.packs} context packs`);
    const v = parsed.data;
    const row = await this.repo.savePack(s.data, {
      name: v.name, description: v.description, body: v.body, source: v.source, audience: v.audience, pinned: v.pinned,
      position: v.position ?? current?.position ?? packs.length,
    });
    return toPack(row);
  }

  async deletePack(slug: string): Promise<void> {
    if (!(await this.repo.packs()).some(p => p.slug === slug)) throw new NotFoundException('Context pack not found');
    await this.repo.deletePack(slug);
  }

  /**
   * Which packs the role has switched on. Each must exist and have the role in its audience; pinned packs need no switch.
   * Saved in the role's config, so the change is in the role's audit trail.
   */
  async setRoleContext(roleId: string, body: unknown): Promise<RoleContext> {
    const parsed = setRoleContextSchema.safeParse(body);
    if (!parsed.success) throw bad(parsed.error);
    const role = await this.team.getRole(roleId);
    const packs = await this.packs();
    const wanted = [...new Set(parsed.data.packs)];
    const unknown = wanted.filter(slug => !packs.some(p => p.slug === slug));
    if (unknown.length) throw new BadRequestException(`No such context pack: ${unknown.join(', ')}`);
    const r = resolveContext(packs, role.key, wanted);
    if (r.stale.length) throw new ConflictException(`"${role.key}" is outside the audience of: ${r.stale.join(', ')}. Change the pack's audience first.`);
    const switched = wanted.filter(slug => !r.pinned.some(p => p.slug === slug));
    const improvements = await this.repo.improvements({ roleId });
    const next = { ...role, config: { ...role.config, context: switched } };
    const total = role.prompt.length + this.textFor(next, packs, improvements).length;
    if (total > CONTEXT_LIMITS.roleChars) {
      throw new ConflictException(`"${role.key}" would read ${total} characters, over the limit of ${CONTEXT_LIMITS.roleChars}. Switch a pack off or shorten one.`);
    }
    const updated = await this.team.updateRole(roleId, { config: next.config });
    return this.roleContext(updated, packs, improvements);
  }

  // ---------- improvements ----------

  async improvements(query: { status?: string; role?: string } = {}): Promise<Improvement[]> {
    const rows = await this.repo.improvements({ status: query.status || undefined });
    return rows.filter(r => !query.role || r.role_key === query.role || r.role_id === query.role).map(toImprovement);
  }

  /** A proposal entered by hand or by a session outside a run (the web UI, the MCP server, a script). */
  async propose(roleId: string, body: unknown): Promise<Improvement> {
    const parsed = proposeImprovementSchema.safeParse(body);
    if (!parsed.success) throw bad(parsed.error);
    const role = await this.team.getRole(roleId);
    const result = await this.add(role, parsed.data, await this.packs(), await this.repo.improvements({ roleId }));
    if (typeof result === 'string') throw new ConflictException(result);
    return toImprovement(result);
  }

  /** What a step's report proposed. Never fails the step: what cannot be kept is dropped and logged. */
  async proposeImprovements(roleKey: string, items: ProposedImprovement[], source: string): Promise<number> {
    if (!items.length) return 0;
    const role = await this.team.getByKey(roleKey);
    if (!role) return 0;
    const packs = await this.packs();
    let kept = 0;
    for (const item of items.slice(0, CONTEXT_LIMITS.perStep)) {
      const parsed = proposeImprovementSchema.safeParse({ ...item, source: source.slice(0, CONTEXT_LIMITS.proposalSource) });
      const result = parsed.success ? await this.add(role, parsed.data, packs, await this.repo.improvements({ roleId: role.id })) : 'not valid';
      if (typeof result === 'string') log.info({ role: roleKey, why: result }, 'improvement proposal dropped');
      else kept++;
    }
    return kept;
  }

  /** The saved row, or why the proposal is not kept. */
  private async add(role: Role, v: ProposeImprovement, packs: ContextPack[], existing: TeamImprovementRow[]): Promise<TeamImprovementRow | string> {
    if (v.kind === 'context') {
      const pack = packs.find(p => p.slug === v.pack);
      if (!pack) return `No such context pack: ${v.pack}`;
      if (resolveContext(packs, role.key, switchedOnPacks(role.config)).using.some(p => p.slug === pack.slug)) return `"${role.key}" already reads ${pack.slug}`;
    }
    const fingerprint = fingerprintOf(v);
    // a pack that was approved and later switched off can be asked for again; a lesson is never proposed twice
    const same = existing.find(i => i.fingerprint === fingerprint && i.status !== 'retired' && !(v.kind === 'context' && i.status === 'approved'));
    if (same) return `The same proposal already exists for "${role.key}" (${same.status})`;
    if (existing.filter(i => i.status === 'proposed').length >= CONTEXT_LIMITS.pendingPerRole) {
      return `"${role.key}" already has ${CONTEXT_LIMITS.pendingPerRole} proposals waiting; decide on those first`;
    }
    return this.repo.insertImprovement({ role_id: role.id, role_key: role.key, kind: v.kind, text: v.text, reason: v.reason, pack: v.pack, source: v.source, fingerprint });
  }

  /**
   * approve: a lesson joins the role's context (the owner may reword it); a context request switches the pack on.
   * reject: the role is told not to propose it again. retire: an approved lesson no longer applies.
   */
  async decide(id: string, body: unknown): Promise<Improvement> {
    const parsed = decideImprovementSchema.safeParse(body);
    if (!parsed.success) throw bad(parsed.error);
    const { decision, note, text } = parsed.data;
    const row = await this.repo.improvement(id);
    if (!row) throw new NotFoundException('Proposal not found');
    const allowed: Record<typeof decision, string[]> = { approve: ['proposed', 'rejected', 'retired'], reject: ['proposed'], retire: ['approved'] };
    if (!allowed[decision].includes(row.status)) throw new ConflictException(`Cannot ${decision} a proposal that is ${row.status}`);
    const decided = { note, decided_at: new Date() };
    if (decision !== 'approve') {
      return toImprovement((await this.repo.updateImprovement(id, { status: decision === 'reject' ? 'rejected' : 'retired', ...decided }))!);
    }
    const role = await this.team.getRole(row.role_id);
    const [packs, existing] = await Promise.all([this.packs(), this.repo.improvements({ roleId: role.id })]);
    if (row.kind === 'context') {
      const pack = packs.find(p => p.slug === row.pack);
      if (!pack) throw new ConflictException(`The context pack ${row.pack} no longer exists`);
      const switched = switchedOnPacks(role.config);
      const state = resolveContext(packs, role.key, switched);
      if (state.blocked.some(p => p.slug === pack.slug)) throw new ConflictException(`"${role.key}" is outside the audience of ${pack.slug}. Change the pack's audience first, then approve.`);
      if (!state.using.some(p => p.slug === pack.slug)) await this.setRoleContext(role.id, { packs: [...switched.filter(s => !state.stale.includes(s)), pack.slug] });
      return toImprovement((await this.repo.updateImprovement(id, { status: 'approved', ...decided }))!);
    }
    const approved = existing.filter(i => i.kind === 'lesson' && i.status === 'approved');
    if (approved.length >= CONTEXT_LIMITS.lessonsPerRole) throw new ConflictException(`"${role.key}" already has ${CONTEXT_LIMITS.lessonsPerRole} lessons. Retire one first, or merge them into the role's prompt.`);
    const finalText = text ?? row.text;
    const fingerprint = improvementFingerprint(finalText);
    if (existing.some(i => i.id !== id && i.status === 'approved' && i.fingerprint === fingerprint)) throw new ConflictException('The same lesson is already approved for this role');
    const added = finalText.length + 3;
    const now = role.prompt.length + this.textFor(role, packs, existing).length;
    if (now + added > CONTEXT_LIMITS.roleChars) throw new ConflictException(`"${role.key}" would read over ${CONTEXT_LIMITS.roleChars} characters. Switch a pack off or retire a lesson first.`);
    return toImprovement((await this.repo.updateImprovement(id, { status: 'approved', text: finalText, fingerprint, ...decided }))!);
  }
}
