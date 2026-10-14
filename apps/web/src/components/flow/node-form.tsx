import { Trash2 } from 'lucide-react';
import type { NodeType, WorkflowNode } from '@tesserax/contracts';
import { ConditionEditor } from '@/components/conditions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';

export interface NodeTypeInfo {
  type: NodeType;
  title: string;
  description: string;
  ports: string[];
  schema: { properties?: Record<string, JsonProp>; required?: string[] };
}
export interface JsonProp {
  type?: string | string[];
  enum?: string[];
  items?: { type?: string };
  default?: unknown;
  description?: string;
  anyOf?: JsonProp[];
}
export interface SkillInfo { path: string; name: string; description: string }

export function defaultsFor(t?: NodeTypeInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(t?.schema.properties ?? {})) {
    if (p.default !== undefined) out[k] = p.default;
    else if (k === 'prompt') out[k] = '{{issue}}\n\n{{feedback}}';
    else if (k === 'output') out[k] = 'notes';
    else if (k === 'commands') out[k] = ['echo ok'];
  }
  return out;
}

const LONG_TEXT = new Set(['prompt', 'instructions']);
const typeOf = (p: JsonProp): string => {
  if (p.enum) return 'enum';
  const t = Array.isArray(p.type) ? p.type.find(x => x !== 'null') : p.type ?? p.anyOf?.find(a => a.type && a.type !== 'null')?.type;
  return String(t ?? 'string');
};

export function NodeForm({ node, info, skills, onChange, onDelete }: {
  node: WorkflowNode; info?: NodeTypeInfo; skills: SkillInfo[]; onChange: (p: Partial<WorkflowNode>) => void; onDelete?: () => void;
}) {
  const cfg = node.config as Record<string, unknown>;
  const set = (k: string, v: unknown) => {
    const next = { ...cfg };
    if (v === undefined || v === '') delete next[k];
    else next[k] = v;
    onChange({ config: next });
  };
  const props = Object.entries(info?.schema.properties ?? {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>{info?.title ?? node.type} <code className="text-xs font-normal text-muted-foreground">{node.id}</code></CardTitle>
        <p className="text-xs text-muted-foreground">{info?.description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 text-sm">
        <label className="flex flex-col gap-1 text-xs">Label
          <Input value={node.label} onChange={e => onChange({ label: e.target.value })} />
        </label>
        {props.map(([k, p]) => {
          const kind = typeOf(p);
          const v = cfg[k];
          if (k === 'skill') {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">Skill
                <Select value={String(v ?? '')} onChange={e => set(k, e.target.value || undefined)}>
                  <option value="">(none)</option>
                  {skills.map(s => <option key={s.path} value={s.path}>{s.name}</option>)}
                </Select>
              </label>
            );
          }
          if (k === 'skills') {
            const list = (v as string[] | undefined) ?? [];
            return (
              <fieldset key={k} className="flex flex-col gap-1 text-xs">
                <legend className="mb-1">Skills</legend>
                {skills.map(s => (
                  <label key={s.path} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={list.includes(s.path)} onChange={e => set(k, e.target.checked ? [...list, s.path] : list.filter(x => x !== s.path))} />{s.name}
                  </label>
                ))}
              </fieldset>
            );
          }
          if (kind === 'enum') {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">{k}
                <Select value={String(v ?? p.default ?? '')} onChange={e => set(k, e.target.value)}>{p.enum!.map(o => <option key={o}>{o}</option>)}</Select>
              </label>
            );
          }
          if (kind === 'array') {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">{k} <span className="text-muted-foreground">(one per line)</span>
                <textarea className="min-h-20 rounded-md border bg-background p-2 font-mono text-xs" value={((v as string[] | undefined) ?? []).join('\n')}
                  placeholder={Array.isArray(p.default) && p.default.length ? `default:\n${(p.default as string[]).join('\n')}` : ''}
                  onChange={e => {
                    const lines = e.target.value.split('\n').map(s => s.trim());
                    // keep the typed lines while editing; an empty box means "use the default"
                    set(k, lines.some(Boolean) ? lines.filter((l, i) => l || i === lines.length - 1) : undefined);
                  }} />
              </label>
            );
          }
          if (kind === 'number' || kind === 'integer') {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">{k}
                <Input type="number" value={v === undefined ? '' : String(v)} placeholder={p.default !== undefined ? String(p.default) : ''} onChange={e => set(k, e.target.value === '' ? undefined : Number(e.target.value))} />
              </label>
            );
          }
          if (LONG_TEXT.has(k)) {
            return (
              <label key={k} className="flex flex-col gap-1 text-xs">{k}
                <textarea className="min-h-40 rounded-md border bg-background p-2 font-mono text-xs" value={String(v ?? '')} onChange={e => set(k, e.target.value)} />
                {k === 'prompt' && <span className="text-[11px] text-muted-foreground">Placeholders: {'{{issue}} {{issue_key}} {{artifact:<name>}} {{feedback}} {{branch}} {{base_ref}} {{diff}} {{repo_path}}'}</span>}
              </label>
            );
          }
          return (
            <label key={k} className="flex flex-col gap-1 text-xs">{k}
              <Input value={String(v ?? '')} placeholder={p.default !== undefined ? String(p.default) : ''} onChange={e => set(k, e.target.value)} />
            </label>
          );
        })}
        {node.type !== 'trigger.jira' && (
          <div className="flex flex-col gap-1.5 rounded-md border p-2">
            <div className="text-xs font-medium">Skip this node when (all hold)</div>
            <ConditionEditor value={node.skipIf ?? []} onChange={v => onChange({ skipIf: v.length ? v : undefined })} />
            {!!node.skipIf?.length && (
              <label className="flex items-center gap-1.5 text-xs">and continue through
                <select className="h-7 rounded border bg-card px-1" value={node.skipPort ?? info?.ports[0] ?? ''} onChange={e => onChange({ skipPort: e.target.value })}>
                  {(info?.ports ?? []).map(p => <option key={p}>{p}</option>)}
                </select>
              </label>
            )}
            <p className="text-[11px] text-muted-foreground">AI type needs a “Classify” node earlier in the workflow.</p>
          </div>
        )}
        {onDelete && <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="size-3.5" />Delete node</Button>}
      </CardContent>
    </Card>
  );
}
