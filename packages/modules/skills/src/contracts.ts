import { z } from 'zod';

/** Suggested categories for the Skills page; any lowercase slug is accepted. */
export const SKILL_PACKAGE_CATEGORIES = ['code-review', 'coding-style', 'docs', 'testing', 'general'] as const;

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'Use lowercase letters, digits and dashes');

/** One external package in skills/packages.json: a git repo whose SKILL.md files are copied into skills/_packages/<id>/. */
export const skillPackageSchema = z.object({
  id: slug,
  source: z.string(), // git URL
  ref: z.string().nullable(), // branch or tag asked for; null = the repo's default branch
  commit: z.string(), // commit the files were copied from
  version: z.string().nullable(), // from package.json / plugin.json, when the repo has one
  license: z.string().nullable(), // first line of LICENSE
  category: slug,
  installedAt: z.string(),
  updatedAt: z.string(),
  skills: z.array(z.string()), // skill names (folder names under skills/_packages/<id>/)
});
export type SkillPackage = z.infer<typeof skillPackageSchema>;

export const skillPackageManifestSchema = z.object({ packages: z.array(skillPackageSchema).default([]) });
export type SkillPackageManifest = z.infer<typeof skillPackageManifestSchema>;

/** POST /api/skill-packages */
export const installSkillPackageSchema = z.object({
  source: z.string().trim().min(1).max(500),
  ref: z.string().trim().max(200).optional(),
  id: slug.optional(), // default: repo name
  category: slug.default('general'),
});
export type InstallSkillPackage = z.infer<typeof installSkillPackageSchema>;

/** PATCH /api/skill-packages/:id */
export const patchSkillPackageSchema = z.object({ category: slug });

/** A skill from a package, in the same shape as GET /api/skills so workflow nodes can pick it by path. */
export const packageSkillSchema = z.object({
  path: z.string(), // skills/_packages/<id>/<name>/SKILL.md
  name: z.string(),
  description: z.string(),
  hash: z.string(),
  package: z.string(),
  category: z.string(),
});
export type PackageSkill = z.infer<typeof packageSkillSchema>;

export interface SkillPackageList {
  packages: (SkillPackage & { usedBy: string[] })[]; // usedBy: workflow ids whose nodes reference the package's skills
}

export const skillFileSchema = z.object({
  content: z
    .string()
    .min(1)
    .max(200_000)
    .refine(s => /^---\r?\n[\s\S]*?^name:\s*\S+[\s\S]*?^description:\s*\S+[\s\S]*?\r?\n---/m.test(s), 'Needs frontmatter with name: and description:'),
});

/** GET /api/skills: the repo's own skills (no body). */
export interface SkillInfo { path: string; name: string; description: string; hash: string }

/** GET /api/skills/:name and GET /api/skill-packages/:id/skills/:skill */
export interface SkillContent { path: string; content: string; hash: string }
