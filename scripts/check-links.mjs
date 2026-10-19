#!/usr/bin/env node
// Checks that relative markdown links in the public docs point to files (and headings) that exist.
// Usage: node scripts/check-links.mjs   (exit 1 with a list when something is broken)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? markdownFiles(path) : path.endsWith('.md') ? [path] : [];
  });
}

const files = [
  ...['README.md', 'CONTRIBUTING.md', 'SECURITY.md'].map((f) => join(root, f)).filter(existsSync),
  ...markdownFiles(join(root, 'docs')),
];

const slug = (heading) =>
  heading.trim().toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

function anchors(file) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));
}

const broken = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  const rel = file.slice(root.length + 1);
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#');
    const dest = path ? resolve(dirname(file), path) : file;
    if (!existsSync(dest)) {
      broken.push(`${rel}: ${target} (no such file)`);
    } else if (anchor && dest.endsWith('.md') && !anchors(dest).has(anchor)) {
      broken.push(`${rel}: ${target} (no such heading)`);
    }
  }
}

if (broken.length) {
  console.error(`Broken links:\n${broken.map((b) => `  ${b}`).join('\n')}`);
  process.exit(1);
}
console.log(`Checked ${files.length} files, all relative links resolve.`);
