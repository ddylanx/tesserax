import { ConflictException, Inject, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@tesserax/config';
import {
  projectSettingsSchema, routingSchema,
  type Project, type ProjectCard, type ProjectDirectory, type SaveProject, type TaskFacts,
} from '@tesserax/contracts';
import { DB, createLogger } from '@tesserax/core';
import type { Db, ProjectRow } from '@tesserax/db';
import { RepoRegistryStore } from '@tesserax/mod-repos';
import { findRuleConflict, matchPath, matchTask } from './match';

const log = createLogger('projects');

const toProject = (r: ProjectRow): Project => ({
  id: r.id, slug: r.slug, name: r.name, color: r.color, kind: r.kind, position: r.position, isDefault: r.is_default,
  settings: projectSettingsSchema.parse(r.settings ?? {}),
});

@Injectable()
export class ProjectsService implements ProjectDirectory, OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repos: RepoRegistryStore,
  ) {}

  /**
   * The default project starts out holding what existed before projects: every Jira key on the workplaces and the routing
   * rules from workflows/routing.json (its settings are empty until this runs once).
   */
  async onModuleInit() {
    const row = await this.db.selectFrom('projects').selectAll().where('is_default', '=', true).executeTakeFirst();
    if (row && !Object.keys((row.settings ?? {}) as object).length) await this.fillDefault(row);
    await this.reassign();
  }

  private async fillDefault(row: ProjectRow) {
    const jiraKeys = [...new Set(this.repos.read().workplaces.flatMap(w => w.projects))];
    let routing = routingSchema.parse({});
    const file = join(findRepoRoot(), 'workflows', 'routing.json');
    if (existsSync(file)) {
      const parsed = routingSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (parsed.success) routing = parsed.data;
    }
    const settings = projectSettingsSchema.parse({ rules: { jiraKeys }, routing });
    await this.db.updateTable('projects').set({ settings: JSON.stringify(settings) }).where('id', '=', row.id).execute();
    log.info({ project: row.slug, jiraKeys: jiraKeys.length }, 'default project filled from existing workplaces and routing');
  }

  async saveRouting(idOrSlug: string, routing: ReturnType<typeof routingSchema.parse>): Promise<Project> {
    const p = await this.get(idOrSlug);
    if (!p) throw new NotFoundException('Project not found');
    return this.save(p.slug, { name: p.name, color: p.color, kind: p.kind, settings: { ...p.settings, routing } });
  }

  /** Re-applies the rules to every task that was not moved by hand (optionally one source). Returns how many changed project. */
  async reassign(sourceId?: string): Promise<number> {
    const projects = await this.list();
    if (!projects.some(p => p.isDefault)) return 0;
    let q = this.db.selectFrom('tasks').select(['id', 'project', 'source_id', 'project_id']).where('project_pinned', '=', false);
    if (sourceId) q = q.where('source_id', '=', sourceId);
    const moves = new Map<string, string[]>();
    for (const t of await q.execute()) {
      const target = matchTask(projects, { project: t.project, sourceId: t.source_id });
      if (target.id !== t.project_id) moves.set(target.id, [...(moves.get(target.id) ?? []), t.id]);
    }
    let changed = 0;
    for (const [projectId, ids] of moves) {
      for (let i = 0; i < ids.length; i += 500) {
        await this.db.updateTable('tasks').set({ project_id: projectId }).where('id', 'in', ids.slice(i, i + 500)).execute();
      }
      changed += ids.length;
    }
    if (changed) log.info({ changed }, 'tasks sorted into projects');
    return changed;
  }

  async addWorkplaceToDefault(workplaceId: string): Promise<void> {
    const row = await this.db.selectFrom('projects').selectAll().where('is_default', '=', true).executeTakeFirst();
    if (!row) return;
    const settings = projectSettingsSchema.parse(row.settings ?? {});
    if (settings.workplaceIds.length > 0 && !settings.workplaceIds.includes(workplaceId)) {
      settings.workplaceIds.push(workplaceId);
      await this.db.updateTable('projects').set({ settings: JSON.stringify(settings) }).where('id', '=', row.id).execute();
    }
  }

  async list(): Promise<Project[]> {
    const rows = await this.db.selectFrom('projects').selectAll().orderBy('position').orderBy('created_at').execute();
    return rows.map(toProject);
  }

  async get(idOrSlug: string): Promise<Project | null> {
    const isId = /^[0-9a-f-]{36}$/i.test(idOrSlug);
    const row = await this.db.selectFrom('projects').selectAll().where(isId ? 'id' : 'slug', '=', idOrSlug).executeTakeFirst();
    return row ? toProject(row) : null;
  }

  async resolveForTask(task: TaskFacts): Promise<Project> {
    return matchTask(await this.list(), task);
  }

  /** A run's worktree is more specific than a workplace folder, so it is looked up first. */
  async resolveForPath(cwd: string): Promise<Project | null> {
    const dir = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
    const wt = await this.db
      .selectFrom('workflow_runs')
      .select('project_id')
      .where('project_id', 'is not', null)
      .where('worktree_path', 'is not', null)
      .where(sql<boolean>`${dir} = worktree_path or ${dir} like worktree_path || '/%'`)
      .orderBy(sql`length(worktree_path)`, 'desc')
      .limit(1)
      .executeTakeFirst();
    const projects = await this.list();
    if (wt?.project_id) return projects.find(p => p.id === wt.project_id) ?? null;

    const workplaces = this.repos.read().workplaces;
    const claimed = new Set(projects.flatMap(p => p.settings.workplaceIds));
    const entries = projects.map(p => ({
      projectId: p.id,
      // a project listing no workplaces (the default one) takes the workplaces nobody else lists
      paths: workplaces.filter(w => (p.settings.workplaceIds.length ? p.settings.workplaceIds.includes(w.id) : p.isDefault && !claimed.has(w.id))).map(w => w.path),
    }));
    const id = matchPath(entries, dir);
    return id ? (projects.find(p => p.id === id) ?? null) : null;
  }

  async cards(): Promise<ProjectCard[]> {
    const projects = await this.list();
    const tasks = await this.db
      .selectFrom('tasks')
      .select(['project_id', sql<number>`count(*)::int`.as('n')])
      .where('status_category', '=', 'in_progress')
      .where('archived_at', 'is', null)
      .groupBy('project_id')
      .execute();
    const runs = await this.db
      .selectFrom('workflow_runs')
      .select(['project_id', 'status', sql<number>`count(*)::int`.as('n')])
      .where('status', 'in', ['waiting', 'failed'])
      .groupBy(['project_id', 'status'])
      .execute();
    const count = <T extends { project_id: string | null; n: number }>(rows: T[], id: string, pick: (r: T) => boolean = () => true) =>
      rows.filter(r => r.project_id === id && pick(r)).reduce((a, r) => a + r.n, 0);
    return projects.map(p => ({
      ...p,
      summary: {
        inProgress: count(tasks, p.id),
        waitingForYou: count(runs, p.id, r => r.status === 'waiting'),
        failedRuns: count(runs, p.id, r => r.status === 'failed'),
      },
    }));
  }

  async create(input: SaveProject): Promise<Project> {
    const all = await this.list();
    if (all.some(p => p.slug === input.slug)) throw new ConflictException(`A project with the slug "${input.slug}" already exists.`);
    const conflict = findRuleConflict(all, input.settings);
    if (conflict) throw new ConflictException(conflict);
    const position = Math.max(0, ...all.map(p => p.position)) + 1;
    const row = await this.db
      .insertInto('projects')
      .values({ slug: input.slug, name: input.name, color: input.color, kind: input.kind, position, settings: JSON.stringify(input.settings) })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toProject(row);
  }

  async save(slug: string, input: Omit<SaveProject, 'slug'>): Promise<Project> {
    const all = await this.list();
    const current = all.find(p => p.slug === slug);
    if (!current) throw new NotFoundException('Project not found');
    const conflict = findRuleConflict(all.filter(p => p.id !== current.id), input.settings);
    if (conflict) throw new ConflictException(conflict);
    const row = await this.db
      .updateTable('projects')
      .set({ name: input.name, color: input.color, kind: input.kind, settings: JSON.stringify(input.settings) })
      .where('id', '=', current.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toProject(row);
  }

  /** Tasks and sources move to the default project; the default project itself cannot be removed. */
  async remove(slug: string): Promise<void> {
    const all = await this.list();
    const project = all.find(p => p.slug === slug);
    const fallback = all.find(p => p.isDefault);
    if (!project) throw new NotFoundException('Project not found');
    if (project.isDefault || !fallback) throw new ConflictException('The default project cannot be deleted.');
    await this.db.transaction().execute(async trx => {
      const sources = await trx.selectFrom('sources').selectAll().where('project_id', '=', project.id).execute();
      for (const s of sources) {
        const twin = await trx.selectFrom('sources').select('id').where('project_id', '=', fallback.id).where('kind', '=', s.kind).where('name', '=', s.name).executeTakeFirst();
        if (twin) {
          await trx.updateTable('tasks').set({ source_id: twin.id }).where('source_id', '=', s.id).execute();
          await trx.deleteFrom('sources').where('id', '=', s.id).execute();
        } else {
          await trx.updateTable('sources').set({ project_id: fallback.id }).where('id', '=', s.id).execute();
        }
      }
      await trx.updateTable('tasks').set({ project_id: fallback.id, project_pinned: false }).where('project_id', '=', project.id).execute();
      await trx.deleteFrom('projects').where('id', '=', project.id).execute();
    });
  }
}
