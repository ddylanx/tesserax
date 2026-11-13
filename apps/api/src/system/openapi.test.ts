import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { API_ROUTES, buildOpenApi } from '@tesserax/contracts';

const root = resolve(__dirname, '../../../..');

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules') continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) controllerFiles(p, out);
    else if (f.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

/** Routes declared with Nest decorators, as "get /path/{param}". */
function declaredRoutes(): string[] {
  const routes: string[] = [];
  for (const file of [...controllerFiles(join(root, 'apps/api/src')), ...controllerFiles(join(root, 'packages/modules'))]) {
    const src = readFileSync(file, 'utf8');
    const prefix = /@Controller\((?:'([^']*)')?\)/.exec(src)?.[1] ?? '';
    for (const m of src.matchAll(/@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g)) {
      const path = ['', prefix, m[2] ?? ''].filter((p, i) => i === 0 || p).join('/').replace(/:(\w+)/g, '{$1}');
      routes.push(`${m[1]!.toLowerCase()} ${path}`);
    }
  }
  return routes.sort();
}

test('every controller route is described in API_ROUTES (and nothing else)', () => {
  const listed = API_ROUTES.map(r => `${r.method} ${r.path}`).sort();
  assert.deepEqual(listed, declaredRoutes());
});

test('the OpenAPI document builds and marks outward routes', () => {
  const doc = buildOpenApi({ serverUrl: 'http://127.0.0.1:4400' });
  const confirm = (doc.paths['/api/workflow-runs/{id}/confirm'] as Record<string, Record<string, unknown>>).post!;
  assert.equal(confirm['x-tesserax-outward'], true);
  assert.ok(doc.paths['/health']);
  const list = (doc.paths['/api/tasks'] as Record<string, { parameters: { name: string }[] }>).get!;
  assert.ok(list.parameters.some(p => p.name === 'project'));
  assert.doesNotThrow(() => JSON.stringify(doc));
});
