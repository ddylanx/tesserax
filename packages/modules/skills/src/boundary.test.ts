import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const files = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : []));
const importsOf = (f: string) => [...readFileSync(f, 'utf8').matchAll(/from '([^']+)'/g)].map(m => m[1]!);

test('the module imports nothing from the host app', () => {
  const bad = files(__dirname).flatMap(f => importsOf(f).filter(i => i.startsWith('@tesserax/') || i.startsWith('@/')).map(i => `${f}: ${i}`));
  assert.deepEqual(bad, []);
});

test('contracts and web code stay browser-safe', () => {
  const browser = [join(__dirname, 'contracts.ts'), ...files(join(__dirname, 'web'))];
  const bad = browser.flatMap(f =>
    importsOf(f).filter(i => i.startsWith('node:') || i.startsWith('@nestjs/') || (i.startsWith('..') && i !== '../contracts')).map(i => `${f}: ${i}`),
  );
  assert.deepEqual(bad, []);
});
