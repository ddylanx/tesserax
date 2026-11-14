import {
  ENGINE_NODE_TYPES, MODEL_NODE_TYPES, ROLE_NODE_TYPES, ROLE_TOOL_ALLOWLIST, roleBrief, roleConfigSchema, roleInScope, rolePromptSchema,
  type ReportLanguage,
  type Role, type RoleLookup, type WorkflowDefinition, type WorkflowNode,
} from '@tesserax/contracts';
import { FatalNodeError } from './executors/types';

/** What a step keeps of its Team role: prompt (prepended), skills (merged with the node's) and the hash recorded on node_runs. */
export interface AppliedRole {
  key: string;
  title: string;
  prompt: string;
  hash: string;
  skills: string[];
  /** "## Your role" section (mission, when to use, not for, inputs needed); '' when the role has no descriptor. */
  brief: string;
  /** Context packs the role reads and its approved lessons (Context page); '' when it has none. */
  context: string;
  reportLanguage: ReportLanguage;
}

const has = (list: readonly string[], v: string) => list.includes(v);
const unset = (v: unknown) => v === undefined || v === null || v === '';

/**
 * Fills a node's RAW config (before the node type's schema adds defaults) from its role: a field the node sets wins, the role
 * fills the rest. Tools: the role can only narrow what the node lists (or gives its own list when the node lists none).
 * The role's config is checked again here (it may have been edited in the database since it was saved), so a bad row fails
 * the step instead of widening what the agent may do. Role MCP servers only become the node's request to the MCP policy.
 */
export function applyRole(raw: Record<string, unknown>, role: Role, nodeType: string): { config: Record<string, unknown>; role: AppliedRole } {
  const parsed = roleConfigSchema.safeParse(role.config);
  if (!parsed.success) throw new FatalNodeError(`Role "${role.key}" has an invalid config (${parsed.error.issues.map(i => `${i.path.join('.') || 'config'} ${i.message}`).join('; ')}); fix it on the Team page.`);
  const prompt = rolePromptSchema.safeParse(role.prompt);
  if (!prompt.success) throw new FatalNodeError(`Role "${role.key}" has an invalid prompt; fix it on the Team page.`);
  const rc = parsed.data;
  const outside = (rc.allowedTools ?? []).filter(t => !has(ROLE_TOOL_ALLOWLIST, t));
  if (outside.length) throw new FatalNodeError(`Role "${role.key}" allows tools outside the allow-list: ${outside.join(', ')}`);

  const config: Record<string, unknown> = { ...raw };
  const fill = (key: string, value: unknown) => {
    if (value !== undefined && unset(config[key])) config[key] = value;
  };
  if (has(ENGINE_NODE_TYPES, nodeType)) fill('engine', rc.engine);
  // a model id belongs to its engine: take the role's model only when the step runs on the role's engine
  const engine = config.engine as string | undefined;
  if (has(MODEL_NODE_TYPES, nodeType) && (!rc.engine || !has(ENGINE_NODE_TYPES, nodeType) || (engine ?? 'claude') === rc.engine)) fill('model', rc.model);
  fill('maxBudgetUsd', rc.maxBudgetUsd);
  fill('timeoutSeconds', rc.timeoutSeconds);
  fill('mcp', rc.mcp);
  if (nodeType === 'agent.run') fill('executor', rc.executor);
  if (rc.allowedTools) {
    const roleTools = rc.allowedTools as string[];
    config.allowedTools = Array.isArray(raw.allowedTools) ? (raw.allowedTools as unknown[]).filter((t): t is string => typeof t === 'string' && roleTools.includes(t)) : [...roleTools];
  }
  return {
    config,
    role: { key: role.key, title: role.title, prompt: prompt.data, hash: role.hash, skills: rc.skills, brief: roleBrief(rc), context: role.contextText ?? '', reportLanguage: rc.reportLanguage },
  };
}

/** A role as it was when the run started (workflow_runs.vars.roles[key]). */
export interface RoleSnapshot {
  title: string;
  enabled: boolean;
  hash: string;
  prompt: string;
  config: Record<string, unknown>;
  /** The role's context text at that time (packs + approved lessons). */
  context?: string;
}

/**
 * Every role the workflow names, as it is now; stored on the run when it starts so later edits on the Team page do not change
 * a run half way (retries and "run again from here" keep it; a new run takes the latest). Unknown keys are left out (the
 * node then fails with "not found").
 */
export async function snapshotRoles(lookup: RoleLookup | undefined, def: Pick<WorkflowDefinition, 'nodes'>): Promise<Record<string, RoleSnapshot>> {
  const keys = [...new Set(def.nodes.filter(n => has(ROLE_NODE_TYPES, n.type)).map(n => (n.config as { role?: unknown })?.role).filter((k): k is string => typeof k === 'string' && !!k))];
  const out: Record<string, RoleSnapshot> = {};
  for (const key of keys) {
    const r = lookup ? await lookup.getByKey(key) : null;
    if (r) out[key] = { title: r.title, enabled: r.enabled, hash: r.hash, prompt: r.prompt, config: r.config, ...(r.contextText ? { context: r.contextText } : {}) };
  }
  return out;
}

/** The roles a run uses: its snapshot when it has one, else (runs started before snapshots existed) the live Team rows. */
export function runRoleLookup(runVars: unknown, live: RoleLookup | undefined): RoleLookup | undefined {
  const snap = (runVars as { roles?: Record<string, RoleSnapshot> } | null)?.roles;
  if (!snap || typeof snap !== 'object') return live;
  return {
    getByKey: async key => {
      const s = snap[key];
      if (!s) return null;
      const [dept = '', slug = ''] = key.split('/');
      return { id: `snapshot:${key}`, key, departmentId: dept, slug, title: s.title, enabled: s.enabled, prompt: s.prompt, config: s.config, position: 0, hash: s.hash, problems: [], usedBy: [], contextText: s.context ?? '' };
    },
    keys: async () => Object.keys(snap),
  };
}

/** The node's config with its role applied (unchanged when it names none). Fails the step when the role cannot be used. */
export async function resolveRole(
  lookup: RoleLookup | undefined,
  node: Pick<WorkflowNode, 'type' | 'config'>,
  project: { name: string; settings: { roles?: string[] | null } } | null,
): Promise<{ config: Record<string, unknown>; role: AppliedRole | null }> {
  const raw = (node.config ?? {}) as Record<string, unknown>;
  const key = typeof raw.role === 'string' ? raw.role : '';
  if (!key || !has(ROLE_NODE_TYPES, node.type)) return { config: raw, role: null };
  const role = lookup ? await lookup.getByKey(key) : null;
  if (!role || !role.enabled) throw new FatalNodeError(`Role ${key} not found or disabled on the Team page`);
  if (!roleInScope(project, key)) throw new FatalNodeError(`Role "${key}" is not enabled in project "${project!.name}".`);
  return applyRole(raw, role, node.type);
}

/**
 * What you picked on the run page for this run only wins over the workflow (and its role): the engine (a model the workflow
 * named is for its own engine, so it is dropped) and the model. Applied to the PARSED config.
 */
export function applyRunOverrides(config: Record<string, unknown>, node: Pick<WorkflowNode, 'id' | 'type'>, runVars: unknown): { modelOverride?: string } {
  const vars = (runVars ?? {}) as { engine?: Record<string, string>; model?: Record<string, string> };
  const engineOverride = vars.engine?.[node.id];
  if (engineOverride && 'engine' in config && engineOverride !== config.engine) Object.assign(config, { engine: engineOverride, model: undefined });
  const modelOverride = vars.model?.[node.id];
  if (modelOverride && has(MODEL_NODE_TYPES, node.type)) Object.assign(config, { model: modelOverride });
  return { modelOverride };
}
