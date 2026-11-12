import { BadRequestException, ConflictException, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  roleConfigSchema, roleInScope, roleKey, rolePromptSchema, saveDepartmentSchema, saveRoleSchema,
  type Department, type ProjectDirectory, type Role, type RoleChange, type RoleConfig, type RoleLookup, type SaveDepartment,
  type TeamList, type WorkflowUsage,
} from '@tesserax/contracts';
import { createLogger } from '@tesserax/core';
import type { TeamDepartmentRow, TeamRoleRow } from '@tesserax/db';
import type { TeamRepo } from './team.repo';

const log = createLogger('team');

/** Same text for the same value whatever the key order (jsonb reorders keys). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** sha256 of {prompt, config}, first 12 hex chars: stored on every step that used the role. */
export const roleHash = (prompt: string, config: unknown) => createHash('sha256').update(canonical({ prompt, config })).digest('hex').slice(0, 12);

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map(i => `${i.path.join('.') || 'value'}: ${i.message}`);
const bad = (e: { issues: { path: PropertyKey[]; message: string }[] }) => new BadRequestException(issues(e).join('; '));
const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

const toDepartment = (r: TeamDepartmentRow): Department => ({ id: r.id, slug: r.slug, name: r.name, color: r.color, description: r.description, position: r.position });

/** Starter team, inserted once when both tables are empty. Stack-agnostic, allow-listed tools only. */
const SEED: { department: SaveDepartment; roles: { slug: string; title: string; prompt: string; config: RoleConfig }[] }[] = [
  {
    department: { slug: 'engineering', name: 'Engineering', color: '#2563eb', description: 'Builds and changes the code.' },
    roles: [{
      slug: 'backend-dev', title: 'Backend developer',
      prompt: [
        'You are a careful backend developer working in an existing codebase.',
        '- Read the code around the change first and follow its conventions, naming and structure.',
        '- Make the smallest change that fully solves the task; do not refactor unrelated code.',
        '- Add or update tests for the behaviour you change.',
        '- Commit locally with a clear message. Never push, never merge, never touch secrets or credentials.',
      ].join('\n'),
      config: { engine: 'claude', skills: [], allowedTools: ['Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Write', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)'] },
    }],
  },
  {
    department: { slug: 'qa', name: 'QA', color: '#16a34a', description: 'Reviews changes before they ship.' },
    roles: [{
      slug: 'reviewer', title: 'Reviewer',
      prompt: [
        'You are a thorough code reviewer. You only read; you never change files.',
        '- Check the change against the requirement: correctness first, then tests, then readability.',
        '- Point to exact files and lines; say what is wrong and how to fix it.',
        '- Separate blocking problems from suggestions.',
      ].join('\n'),
      config: { engine: 'claude', skills: [], allowedTools: ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)'] },
    }],
  },
  {
    department: { slug: 'docs', name: 'Docs', color: '#9333ea', description: 'Writes documents, comments and pull request text.' },
    roles: [{
      slug: 'tech-writer', title: 'Technical writer',
      prompt: [
        'You are a technical writer. Write plain, short, accurate English for developers.',
        '- Say what changed and why; leave out what the reader can see in the diff.',
        '- Use headings and lists only when they help; no marketing words.',
      ].join('\n'),
      config: { engine: 'claude', skills: [], allowedTools: ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)'] },
    }],
  },
];

export class TeamService implements RoleLookup, OnModuleInit {
  constructor(
    private readonly repo: TeamRepo,
    private readonly usage: WorkflowUsage,
    private readonly projects?: Pick<ProjectDirectory, 'get'>,
  ) {}

  async onModuleInit() {
    await this.seed();
  }

  /** Inserts the starter departments and roles when the Team page has never been used. */
  async seed(): Promise<boolean> {
    const [departments, roles] = await Promise.all([this.repo.departments(), this.repo.roles()]);
    if (departments.length || roles.length) return false;
    await this.repo.transaction(async repo => {
      for (const [i, s] of SEED.entries()) {
        const d = await repo.insertDepartment({ ...s.department, color: s.department.color, description: s.department.description, position: i });
        for (const [j, r] of s.roles.entries()) {
          const row = await repo.insertRole({ department_id: d.id, slug: r.slug, title: r.title, prompt: r.prompt, config: r.config, enabled: true, position: j });
          await repo.addChange({ role_id: row.id, role_key: roleKey(d.slug, r.slug), old_hash: null, new_hash: roleHash(row.prompt, row.config), action: 'create' });
        }
      }
    });
    log.info('starter team created');
    return true;
  }

  private toRole(r: TeamRoleRow, departments: Map<string, TeamDepartmentRow>): Role {
    const key = roleKey(departments.get(r.department_id)?.slug ?? '?', r.slug);
    const config = (r.config && typeof r.config === 'object' ? r.config : {}) as Record<string, unknown>;
    const problems: string[] = [];
    const c = roleConfigSchema.safeParse(config);
    if (!c.success) problems.push(...issues(c.error));
    const p = rolePromptSchema.safeParse(r.prompt);
    if (!p.success) problems.push(...issues(p.error));
    return {
      id: r.id, key, departmentId: r.department_id, slug: r.slug, title: r.title, enabled: r.enabled, prompt: r.prompt, config,
      position: r.position, hash: roleHash(r.prompt, config), problems, usedBy: this.usage.usedBy(key),
    };
  }

  private async load() {
    const [departments, roles] = await Promise.all([this.repo.departments(), this.repo.roles()]);
    const byId = new Map(departments.map(d => [d.id, d]));
    return { departments, byId, roles: roles.map(r => this.toRole(r, byId)) };
  }

  /** Every department; the roles the project allows (all of them without a project). */
  async list(opts: { projectSlug?: string | null } = {}): Promise<TeamList> {
    const { departments, roles } = await this.load();
    const project = opts.projectSlug && this.projects ? await this.projects.get(opts.projectSlug) : null;
    if (opts.projectSlug && this.projects && !project) throw new NotFoundException('Project not found');
    return { departments: departments.map(toDepartment), roles: roles.filter(r => roleInScope(project, r.key)) };
  }

  async getByKey(key: string): Promise<Role | null> {
    return (await this.load()).roles.find(r => r.key === key) ?? null;
  }

  async keys(): Promise<string[]> {
    return (await this.load()).roles.map(r => r.key);
  }

  async getRole(id: string): Promise<Role> {
    const role = (await this.load()).roles.find(r => r.id === id);
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async changes(id: string): Promise<RoleChange[]> {
    await this.getRole(id);
    return (await this.repo.changes(id)).map(c => ({
      id: c.id, roleId: c.role_id, roleKey: c.role_key, oldHash: c.old_hash, newHash: c.new_hash, action: c.action as RoleChange['action'],
      at: new Date(c.at).toISOString(),
    }));
  }

  // ---------- departments ----------

  async createDepartment(body: unknown): Promise<Department> {
    const parsed = saveDepartmentSchema.safeParse(body);
    if (!parsed.success) throw bad(parsed.error);
    const { departments } = await this.load();
    if (departments.some(d => d.slug === parsed.data.slug)) throw new ConflictException(`A department "${parsed.data.slug}" already exists`);
    const v = parsed.data;
    try {
      return toDepartment(await this.repo.insertDepartment({ ...v, position: v.position ?? departments.length }));
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(`A department "${v.slug}" already exists`);
      throw e;
    }
  }

  async updateDepartment(id: string, body: unknown): Promise<Department> {
    const { departments, roles } = await this.load();
    const current = departments.find(d => d.id === id);
    if (!current) throw new NotFoundException('Department not found');
    const parsed = saveDepartmentSchema.safeParse({ ...toDepartment(current), ...(body as object) });
    if (!parsed.success) throw bad(parsed.error);
    const v = parsed.data;
    if (v.slug !== current.slug) {
      const used = roles.filter(r => r.departmentId === id && r.usedBy.length);
      if (used.length) throw new ConflictException(`Cannot rename: ${used.map(r => `${r.key} is used by ${r.usedBy.join(', ')}`).join('; ')}`);
      if (departments.some(d => d.slug === v.slug)) throw new ConflictException(`A department "${v.slug}" already exists`);
    }
    const row = await this.repo.updateDepartment(id, { slug: v.slug, name: v.name, color: v.color, description: v.description, position: v.position ?? current.position });
    if (!row) throw new NotFoundException('Department not found');
    return toDepartment(row);
  }

  async deleteDepartment(id: string): Promise<void> {
    const { departments, roles } = await this.load();
    if (!departments.some(d => d.id === id)) throw new NotFoundException('Department not found');
    const own = roles.filter(r => r.departmentId === id);
    if (own.length) throw new ConflictException(`Move or delete its roles first (${own.map(r => r.key).join(', ')})`);
    await this.repo.deleteDepartment(id);
  }

  // ---------- roles ----------

  async createRole(body: unknown): Promise<Role> {
    const parsed = saveRoleSchema.safeParse(body);
    if (!parsed.success) throw bad(parsed.error);
    const v = parsed.data;
    const { byId, roles } = await this.load();
    const dept = byId.get(v.departmentId);
    if (!dept) throw new BadRequestException('departmentId: no such department');
    const key = roleKey(dept.slug, v.slug);
    if (roles.some(r => r.key === key)) throw new ConflictException(`A role "${key}" already exists`);
    const position = v.position ?? roles.filter(r => r.departmentId === dept.id).length;
    const row = await this.write(() =>
      this.repo.transaction(async repo => {
        const row = await repo.insertRole({ department_id: dept.id, slug: v.slug, title: v.title, prompt: v.prompt, config: v.config, enabled: v.enabled, position });
        await repo.addChange({ role_id: row.id, role_key: key, old_hash: null, new_hash: roleHash(row.prompt, row.config), action: 'create' });
        return row;
      }), key);
    return this.toRole(row, byId);
  }

  async updateRole(id: string, body: unknown): Promise<Role> {
    const { byId, roles } = await this.load();
    const current = roles.find(r => r.id === id);
    if (!current) throw new NotFoundException('Role not found');
    const { departmentId, slug, title, enabled, prompt, config, position } = current;
    const parsed = saveRoleSchema.safeParse({ departmentId, slug, title, enabled, prompt, config, position, ...(body as object) });
    if (!parsed.success) throw bad(parsed.error);
    const v = parsed.data;
    const dept = byId.get(v.departmentId);
    if (!dept) throw new BadRequestException('departmentId: no such department');
    const key = roleKey(dept.slug, v.slug);
    if (key !== current.key) {
      if (current.usedBy.length) throw new ConflictException(`Cannot rename or move "${current.key}": used by ${current.usedBy.join(', ')}`);
      if (roles.some(r => r.key === key)) throw new ConflictException(`A role "${key}" already exists`);
    }
    const row = await this.write(() =>
      this.repo.transaction(async repo => {
        const row = await repo.updateRole(id, { department_id: dept.id, slug: v.slug, title: v.title, prompt: v.prompt, config: v.config, enabled: v.enabled, position: v.position ?? current.position });
        if (!row) throw new NotFoundException('Role not found');
        await repo.addChange({ role_id: id, role_key: key, old_hash: current.hash, new_hash: roleHash(row.prompt, row.config), action: 'update' });
        return row;
      }), key);
    return this.toRole(row, byId);
  }

  async deleteRole(id: string): Promise<void> {
    const current = (await this.load()).roles.find(r => r.id === id);
    if (!current) throw new NotFoundException('Role not found');
    if (current.usedBy.length) throw new ConflictException(`"${current.key}" is used by ${current.usedBy.join(', ')}`);
    await this.repo.transaction(async repo => {
      await repo.deleteRole(id);
      await repo.addChange({ role_id: id, role_key: current.key, old_hash: current.hash, new_hash: null, action: 'delete' });
    });
  }

  private async write<T>(fn: () => Promise<T>, key: string): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(`A role "${key}" already exists`);
      throw e;
    }
  }
}
