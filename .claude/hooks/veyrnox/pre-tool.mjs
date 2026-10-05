#!/usr/bin/env node
// PreToolUse runner for the Veyrnox.ai guards (see rules.mjs). Reads the hook
// payload on stdin and prints a permission decision, or nothing to allow.
// A guard that cannot run (no git, no network) allows: CI is the backstop.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkBundlerTraps,
  checkGitCommand,
  checkInstallCommand,
  checkMigrationPath,
  checkMoneySpine,
  checkSupabaseCall,
  prodRefFromWrangler,
} from './rules.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATION_DIR = 'packages/db/schema/supabase';
const GH_TIMEOUT_MS = 4000;

const run = (cmd, args, timeout = 3000) => {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};
const lines = (out) => (out ? out.split('\n').filter(Boolean) : []);

function takenMigrationNumbers(ownName) {
  const taken = new Map();
  const note = (path, where) => {
    const name = path.split('/').pop();
    if (/^\d{4}_.*\.sql$/.test(name) && name !== ownName && !taken.has(name.slice(0, 4))) taken.set(name.slice(0, 4), where(name));
  };
  lines(run('git', ['ls-files', MIGRATION_DIR])).forEach((p) => note(p, (n) => `${n} in this checkout`));
  lines(run('git', ['ls-tree', '--name-only', 'origin/main', `${MIGRATION_DIR}/`])).forEach((p) => note(p, (n) => `${n} on main`));
  const prs = run('gh', ['pr', 'list', '--repo', 'aljobson/Veyrnox.ai', '--state', 'open', '--limit', '50', '--json', 'number,files'], GH_TIMEOUT_MS);
  try {
    for (const pr of JSON.parse(prs || '[]')) {
      for (const f of pr.files || []) if (f.path.startsWith(MIGRATION_DIR)) note(f.path, (n) => `${n} in open PR ${pr.number}`);
    }
  } catch {
    // gh unavailable: check-migration-numbers.sh in CI still catches a clash.
  }
  return taken;
}

function checkFileEdit(input) {
  if (!input.file_path) return null;
  const rel = relative(ROOT, resolve(input.file_path));
  if (rel.startsWith('..')) return null;
  const text = [input.content, input.new_string, ...(input.edits || []).map((e) => e.new_string)].filter(Boolean).join('\n');
  const name = rel.split('/').pop();
  return (
    checkMoneySpine(rel, text) ||
    checkBundlerTraps(rel, text) ||
    (rel.startsWith(`${MIGRATION_DIR}/`) && rel.endsWith('.sql')
      ? checkMigrationPath(rel, {
          exists: existsSync(resolve(ROOT, rel)),
          onMain: run('git', ['cat-file', '-e', `origin/main:${rel}`]) !== null,
          takenNumbers: existsSync(resolve(ROOT, rel)) ? new Map() : takenMigrationNumbers(name),
        })
      : null)
  );
}

function checkBash(input) {
  const command = String(input.command || '');
  const install = checkInstallCommand(command);
  if (install) return install;
  if (!/\bgit\b/.test(command)) return null;
  let attributionSet = false;
  try {
    attributionSet = Boolean(JSON.parse(readFileSync(resolve(ROOT, '.claude/settings.json'), 'utf8')).attribution?.commit);
  } catch {
    // unreadable settings: treat attribution as unset
  }
  let hardWallOutput = null;
  if (/\bcommit\b/.test(command)) {
    try {
      execFileSync('bash', ['scripts/check-hard-wall.sh'], { cwd: ROOT, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      if (err.status) hardWallOutput = String(err.stdout || '').slice(0, 1500);
    }
  }
  return checkGitCommand(command, {
    attributionSet,
    stagedFiles: lines(run('git', ['diff', '--cached', '--name-only'])),
    untrackedFiles: lines(run('git', ['ls-files', '--others', '--exclude-standard'])),
    hardWallOutput,
  });
}

function checkSupabase(toolName, input) {
  let prodRef = null;
  try {
    prodRef = prodRefFromWrangler(readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8'));
  } catch {
    return null;
  }
  return checkSupabaseCall(toolName.split('__').pop(), input, prodRef);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
const { tool_name: tool = '', tool_input: input = {} } = payload;

let result = null;
if (/^(Write|Edit|MultiEdit)$/.test(tool)) result = checkFileEdit(input);
else if (tool === 'Bash') result = checkBash(input);
else if (/__(apply_migration|execute_sql)$/.test(tool)) result = checkSupabase(tool, input);

if (result) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: `[veyrnox guard] ${result.reason}`,
      },
    })
  );
}
