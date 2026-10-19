import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { syncAntigravityMcpRules } from './antigravity-settings';

test('syncAntigravityMcpRules: keeps user rules and unknown keys, adds and removes only Tesserax rules atomically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-sync-test-'));
  const settingsFile = join(dir, 'settings.json');

  const initialSettings = {
    permissions: {
      allow: ['command(git:*)', 'command(ls:*)'],
    },
    customTheme: 'dark',
    otherSetting: 42,
  };

  writeFileSync(settingsFile, JSON.stringify(initialSettings, null, 2));

  // Step 1: Add Tesserax rule
  await syncAntigravityMcpRules(['mcp(test-server/query)'], {
    settingsFile,
    managedServers: ['test-server'],
  });

  const updated1 = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal(updated1.customTheme, 'dark');
  assert.equal(updated1.otherSetting, 42);
  assert.ok(updated1.permissions.allow.includes('command(git:*)'));
  assert.ok(updated1.permissions.allow.includes('command(ls:*)'));
  assert.ok(updated1.permissions.allow.includes('mcp(test-server/query)'));
  assert.equal(updated1.permissions.allow.length, 3);

  // File mode check (0600 on POSIX)
  if (process.platform !== 'win32') {
    const mode = statSync(settingsFile).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  // Ensure no temporary files (.tmp.*) left in the directory
  const filesAfterStep1 = readdirSync(dir);
  assert.deepEqual(filesAfterStep1, ['settings.json']);

  // Step 2: Remove Tesserax rule
  await syncAntigravityMcpRules([], {
    settingsFile,
    managedServers: ['test-server'],
  });

  const updated2 = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal(updated2.customTheme, 'dark');
  assert.equal(updated2.otherSetting, 42);
  assert.ok(updated2.permissions.allow.includes('command(git:*)'));
  assert.ok(updated2.permissions.allow.includes('command(ls:*)'));
  assert.ok(!updated2.permissions.allow.includes('mcp(test-server/query)'));
  assert.equal(updated2.permissions.allow.length, 2);

  // Check no temp files left
  const filesAfterStep2 = readdirSync(dir);
  assert.deepEqual(filesAfterStep2, ['settings.json']);
});

test('syncAntigravityMcpRules: handles rules with optional whitespace inside mcp(...)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-whitespace-test-'));
  const settingsFile = join(dir, 'settings.json');

  const initialSettings = {
    permissions: {
      allow: ['mcp( custom-srv / tool1 )', 'custom-rule'],
    },
  };
  writeFileSync(settingsFile, JSON.stringify(initialSettings, null, 2));

  // Removing managed server custom-srv should match and strip 'mcp( custom-srv / tool1 )'
  await syncAntigravityMcpRules([], {
    settingsFile,
    managedServers: ['custom-srv'],
  });

  const updated = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.deepEqual(updated.permissions.allow, ['custom-rule']);
});
