import { SkillCatalog } from '@tesserax/mod-skills';
import { FatalNodeError } from './executors/types';

/** The skills a step may use: those the run's project enables (all of them when it lists none). Anything else fails the step. */
export function projectSkills(skills: SkillCatalog, project: { name: string; settings: { skills: string[] | null } } | null): SkillCatalog {
  const enabled = project?.settings.skills;
  if (!enabled) return skills;
  return Object.assign(Object.create(SkillCatalog.prototype), skills, {
    get(path: string) {
      if (!enabled.includes(path)) throw new FatalNodeError(`Skill "${path}" is not enabled in project "${project!.name}".`);
      return skills.get(path);
    },
  }) as SkillCatalog;
}
