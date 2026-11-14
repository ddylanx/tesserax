import type { Db, TeamContextPackRow, TeamImprovementRow } from '@tesserax/db';

export type PackValues = Pick<TeamContextPackRow, 'name' | 'description' | 'body' | 'source' | 'pinned' | 'position'> & { audience: string[] | null };
export type ImprovementValues = Pick<TeamImprovementRow, 'role_id' | 'role_key' | 'kind' | 'text' | 'reason' | 'pack' | 'source' | 'fingerprint'>;
export type ImprovementPatch = Partial<Pick<TeamImprovementRow, 'status' | 'note' | 'text' | 'fingerprint' | 'decided_at'>>;

/** Storage of the Context page. ContextService only talks to this, so its rules can be tested without a database. */
export interface ContextRepo {
  packs(): Promise<TeamContextPackRow[]>;
  /** Creates the pack or replaces its fields. */
  savePack(slug: string, v: PackValues): Promise<TeamContextPackRow>;
  deletePack(slug: string): Promise<void>;
  /** Newest first. */
  improvements(filter?: { roleId?: string; status?: string }): Promise<TeamImprovementRow[]>;
  improvement(id: string): Promise<TeamImprovementRow | undefined>;
  insertImprovement(v: ImprovementValues): Promise<TeamImprovementRow>;
  updateImprovement(id: string, v: ImprovementPatch): Promise<TeamImprovementRow | undefined>;
}

export class KyselyContextRepo implements ContextRepo {
  constructor(private readonly db: Db) {}

  packs() {
    return this.db.selectFrom('team_context_packs').selectAll().orderBy('position').orderBy('name').execute();
  }

  savePack(slug: string, { audience, ...v }: PackValues) {
    const values = { ...v, audience: audience === null ? null : JSON.stringify(audience) };
    return this.db
      .insertInto('team_context_packs')
      .values({ slug, ...values })
      .onConflict(oc => oc.column('slug').doUpdateSet({ ...values, updated_at: new Date() }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deletePack(slug: string) {
    await this.db.deleteFrom('team_context_packs').where('slug', '=', slug).execute();
  }

  improvements(filter: { roleId?: string; status?: string } = {}) {
    let q = this.db.selectFrom('team_improvements').selectAll();
    if (filter.roleId) q = q.where('role_id', '=', filter.roleId);
    if (filter.status) q = q.where('status', '=', filter.status);
    return q.orderBy('created_at', 'desc').limit(1000).execute();
  }

  improvement(id: string) {
    return this.db.selectFrom('team_improvements').selectAll().where('id', '=', id).executeTakeFirst();
  }

  insertImprovement(v: ImprovementValues) {
    return this.db.insertInto('team_improvements').values(v).returningAll().executeTakeFirstOrThrow();
  }

  updateImprovement(id: string, v: ImprovementPatch) {
    return this.db.updateTable('team_improvements').set(v).where('id', '=', id).returningAll().executeTakeFirst();
  }
}
