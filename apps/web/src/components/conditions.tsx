import { Plus, X } from 'lucide-react';
import { CONDITION_FIELDS, type Condition } from '@tesserax/contracts';
import { Button } from '@/components/ui/button';

const FIELD_LABEL: Record<string, string> = {
  'classification.type': 'AI type (bug, feature, chore, research, question)',
  'classification.automation': 'AI automation (auto, assisted, manual)',
  'issue.type': 'Jira issue type',
  'issue.project': 'Jira project',
  'issue.priority': 'Priority',
  'issue.status': 'Status',
  'issue.labels': 'Labels',
  'issue.components': 'Components',
};

/** Rows of "field is / is not value1, value2"; all rows must hold. */
export function ConditionEditor({ value, onChange, fields = CONDITION_FIELDS }: {
  value: Condition[]; onChange: (v: Condition[]) => void; fields?: readonly Condition['field'][];
}) {
  const set = (i: number, patch: Partial<Condition>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-1.5">
      {value.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1 text-xs">
          <select className="h-7 max-w-44 rounded border bg-card px-1" value={c.field} onChange={e => set(i, { field: e.target.value as Condition['field'] })}>
            {fields.map(f => <option key={f} value={f}>{FIELD_LABEL[f] ?? f}</option>)}
          </select>
          <select className="h-7 rounded border bg-card px-1" value={c.op} onChange={e => set(i, { op: e.target.value as Condition['op'] })}>
            <option value="in">is one of</option>
            <option value="not_in">is not</option>
          </select>
          <input className="h-7 min-w-28 flex-1 rounded border bg-background px-1.5" placeholder="value, value" defaultValue={c.values.join(', ')}
            onBlur={e => set(i, { values: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
          <button className="rounded p-1 hover:bg-accent" title="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}><X className="size-3" /></button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="outline" onClick={() => onChange([...value, { field: fields[0]!, op: 'in', values: ['question'] }])}>
          <Plus className="size-3" />Add condition
        </Button>
      </div>
    </div>
  );
}
