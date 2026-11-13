/** Order of the sidebar: groups by label, items by route. Saved per browser. */
export type NavLayout = { group: string; items: string[] }[];
export type Edge = 'before' | 'after';

const STORAGE_KEY = 'tesserax:nav-order';

/** Saved order, with unknown routes dropped and new ones put back at their default place. */
export function mergeLayout(defaults: NavLayout, saved: NavLayout | null): NavLayout {
  if (!saved) return defaults;
  const known = new Set(defaults.flatMap(g => g.items));
  const groups = new Set(defaults.map(g => g.group));
  const seen = new Set<string>();
  const out: NavLayout = [];
  for (const g of saved) {
    if (!groups.has(g.group) || out.some(o => o.group === g.group)) continue;
    const items = g.items.filter(to => known.has(to) && !seen.has(to));
    items.forEach(to => seen.add(to));
    out.push({ group: g.group, items });
  }
  for (const [gi, g] of defaults.entries()) {
    let target = out.find(o => o.group === g.group);
    if (!target) {
      target = { group: g.group, items: [] };
      out.splice(Math.min(gi, out.length), 0, target);
    }
    for (const [i, to] of g.items.entries()) {
      if (seen.has(to)) continue;
      seen.add(to);
      target.items.splice(Math.min(i, target.items.length), 0, to);
    }
  }
  return out;
}

export const sameLayout = (a: NavLayout, b: NavLayout) => JSON.stringify(a) === JSON.stringify(b);

export function loadLayout(): NavLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(v)) return null;
    return v.filter((g): g is NavLayout[number] => typeof g?.group === 'string' && Array.isArray(g.items) && g.items.every((i: unknown) => typeof i === 'string'));
  } catch {
    return null;
  }
}

/** null = back to the default order. */
export function saveLayout(layout: NavLayout | null) {
  try {
    if (layout) localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
}

const without = (layout: NavLayout, to: string): NavLayout => layout.map(g => ({ ...g, items: g.items.filter(i => i !== to) }));

/** Moves an item next to another one (target route), or to the end of a group (target null). */
export function moveItem(layout: NavLayout, to: string, group: string, target: string | null, edge: Edge): NavLayout {
  if (to === target) return layout;
  return without(layout, to).map(g => {
    if (g.group !== group) return g;
    const items = [...g.items];
    const at = target ? items.indexOf(target) : -1;
    items.splice(at < 0 ? items.length : edge === 'after' ? at + 1 : at, 0, to);
    return { ...g, items };
  });
}

export function moveGroup(layout: NavLayout, group: string, target: string, edge: Edge): NavLayout {
  if (group === target) return layout;
  const moving = layout.find(g => g.group === group);
  if (!moving) return layout;
  const rest = layout.filter(g => g.group !== group);
  const at = rest.findIndex(g => g.group === target);
  rest.splice(at < 0 ? rest.length : edge === 'after' ? at + 1 : at, 0, moving);
  return rest;
}

/** One step up or down; past the edge of a group the item moves into the next group. */
export function moveBy(layout: NavLayout, to: string, delta: -1 | 1): NavLayout {
  const gi = layout.findIndex(g => g.items.includes(to));
  if (gi < 0) return layout;
  const items = layout[gi]!.items;
  const i = items.indexOf(to);
  const j = i + delta;
  if (j >= 0 && j < items.length) return moveItem(layout, to, layout[gi]!.group, items[j]!, delta > 0 ? 'after' : 'before');
  const next = layout[gi + delta];
  if (!next) return layout;
  return delta > 0 ? moveItem(layout, to, next.group, next.items[0] ?? null, 'before') : moveItem(layout, to, next.group, null, 'after');
}
