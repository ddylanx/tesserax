import type { SkillInfo } from './contracts';
import type { LocalSkillStore, Skill } from './local-store';
import type { SkillPackageStore } from './package-store';

/** What other modules use: any skill by path (own or from a package), and the list with current hashes. */
export class SkillCatalog {
  constructor(readonly local: LocalSkillStore, readonly packages: SkillPackageStore) {}

  get(path: string): Skill {
    return this.local.get(path);
  }

  list(): SkillInfo[] {
    const own = this.local.list().map(({ body: _b, ...s }) => s);
    const pkg = this.packages.skills().map(({ path, name, description, hash }) => ({ path, name, description, hash }));
    return [...own, ...pkg];
  }
}
