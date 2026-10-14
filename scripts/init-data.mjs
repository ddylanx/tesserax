#!/usr/bin/env node
// Your workflows and skills live in workflows/ and skills/ (gitignored). On first run they start as a copy of examples/.
// Never overwrites: a folder that already has files is left alone.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');

for (const name of ['workflows', 'skills']) {
  const target = join(root, name);
  const source = join(root, 'examples', name);
  if (existsSync(target) && readdirSync(target).length) continue;
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`Created ${name}/ from examples/${name}/ (yours to edit; not committed).`);
}
