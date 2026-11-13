import type { Db, TeamDepartmentRow, TeamRoleChangeRow, TeamRoleRow } from '@tesserax/db';

export type DepartmentValues = Pick<TeamDepartmentRow, 'slug' | 'name' | 'color' | 'description' | 'position'>;
export type RoleValues = Pick<TeamRoleRow, 'department_id' | 'slug' | 'title' | 'prompt' | 'enabled' | 'position'> & { config: unknown };
export type RoleChangeValues = Pick<TeamRoleChangeRow, 'role_id' | 'role_key' | 'old_hash' | 'new_hash' | 'action'>;

/** Storage of the Team page. TeamService only talks to this, so its rules can be tested without a database. */
export interface TeamRepo {
  departments(): Promise<TeamDepartmentRow[]>;
  roles(): Promise<TeamRoleRow[]>;
  insertDepartment(v: DepartmentValues): Promise<TeamDepartmentRow>;
  updateDepartment(id: string, v: Partial<DepartmentValues>): Promise<TeamDepartmentRow | undefined>;
  deleteDepartment(id: string): Promise<void>;
  insertRole(v: RoleValues): Promise<TeamRoleRow>;
  updateRole(id: string, v: Partial<RoleValues>): Promise<TeamRoleRow | undefined>;
  deleteRole(id: string): Promise<void>;
  addChange(v: RoleChangeValues): Promise<void>;
  changes(roleId: string): Promise<TeamRoleChangeRow[]>;
  /** Runs fn with a repo bound to one database transaction. */
  transaction<T>(fn: (repo: TeamRepo) => Promise<T>): Promise<T>;
}

const json = (v: unknown) => JSON.stringify(v ?? {});

export class KyselyTeamRepo implements TeamRepo {
  constructor(private readonly db: Db) {}

  departments() {
    return this.db.selectFrom('team_departments').selectAll().orderBy('position').orderBy('name').execute();
  }

  roles() {
    return this.db.selectFrom('team_roles').selectAll().orderBy('position').orderBy('title').execute();
  }

  insertDepartment(v: DepartmentValues) {
    return this.db.insertInto('team_departments').values(v).returningAll().executeTakeFirstOrThrow();
  }

  updateDepartment(id: string, v: Partial<DepartmentValues>) {
    return this.db.updateTable('team_departments').set({ ...v, updated_at: new Date() }).where('id', '=', id).returningAll().executeTakeFirst();
  }

  async deleteDepartment(id: string) {
    await this.db.deleteFrom('team_departments').where('id', '=', id).execute();
  }

  insertRole({ config, ...v }: RoleValues) {
    return this.db.insertInto('team_roles').values({ ...v, config: json(config) }).returningAll().executeTakeFirstOrThrow();
  }

  updateRole(id: string, { config, ...v }: Partial<RoleValues>) {
    return this.db
      .updateTable('team_roles')
      .set({ ...v, ...(config === undefined ? {} : { config: json(config) }), updated_at: new Date() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteRole(id: string) {
    await this.db.deleteFrom('team_roles').where('id', '=', id).execute();
  }

  async addChange(v: RoleChangeValues) {
    await this.db.insertInto('team_role_changes').values(v).execute();
  }

  changes(roleId: string) {
    return this.db.selectFrom('team_role_changes').selectAll().where('role_id', '=', roleId).orderBy('at', 'desc').limit(100).execute();
  }

  transaction<T>(fn: (repo: TeamRepo) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(trx => fn(new KyselyTeamRepo(trx as unknown as Db)));
  }
}
