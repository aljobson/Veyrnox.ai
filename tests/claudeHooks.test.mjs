import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  checkBundlerTraps,
  checkGitCommand,
  checkInstallCommand,
  checkMigrationPath,
  checkMoneySpine,
  checkSupabaseCall,
  lintMigration,
  prodRefFromWrangler,
} from '../.claude/hooks/veyrnox/rules.mjs';

const PROD = 'prodref';
const gitCtx = (over = {}) => ({ attributionSet: false, stagedFiles: [], untrackedFiles: [], hardWallOutput: null, ...over });
const migCtx = (over = {}) => ({ exists: false, onMain: false, takenNumbers: new Map(), ...over });

test('money spine: raw ledger and balance writes are denied in app code', () => {
  assert.equal(checkMoneySpine('lib/credits.js', 'INSERT INTO ledger_entries (user_id) VALUES ($1)').decision, 'deny');
  assert.equal(checkMoneySpine('app/api/v1/x/route.js', 'update public.credit_balances set balance = 0').decision, 'deny');
  assert.equal(checkMoneySpine('lib/x.js', 'DELETE FROM ledger_entries WHERE id = 1').decision, 'deny');
  assert.equal(checkMoneySpine('lib/x.js', 'UPDATE users SET frozen_at = now()').decision, 'deny');
});

test('money spine: migrations, the db package, tests and reads are left alone', () => {
  const sql = 'INSERT INTO public.ledger_entries (user_id) VALUES (p_user)';
  assert.equal(checkMoneySpine('packages/db/schema/supabase/0190_x.sql', sql), null);
  assert.equal(checkMoneySpine('packages/db/ledger.ts', sql), null);
  assert.equal(checkMoneySpine('scripts/test-ledger-backstops.mjs', sql), null);
  assert.equal(checkMoneySpine('lib/x.js', 'SELECT balance FROM credit_balances WHERE frozen_at IS NULL'), null);
});

test('bundler traps: jose and supabase-js are denied on the SSR graph', () => {
  assert.equal(checkBundlerTraps('middleware.js', "import { jwtVerify } from 'jose'").decision, 'deny');
  assert.equal(checkBundlerTraps('components/A.jsx', 'const s = require("@supabase/supabase-js")').decision, 'deny');
  assert.equal(checkBundlerTraps('lib/a.js', "await import('jose/jwt/verify')").decision, 'deny');
  assert.equal(checkBundlerTraps('package.json', '"tsx": "^4.0.0"').decision, 'deny');
});

test('bundler traps: scripts, tests and lookalike names pass', () => {
  assert.equal(checkBundlerTraps('scripts/x.mjs', "import { jwtVerify } from 'jose'"), null);
  assert.equal(checkBundlerTraps('packages/db/a.test.ts', "import { createClient } from '@supabase/supabase-js'"), null);
  assert.equal(checkBundlerTraps('lib/a.js', "import x from './jose-free'"), null);
});

test('install command: trap packages need --no-save', () => {
  assert.equal(checkInstallCommand('npm install -D tsx').decision, 'deny');
  assert.equal(checkInstallCommand('cd x && npm i jose@5').decision, 'deny');
  assert.equal(checkInstallCommand('npm i --no-save tsx'), null);
  assert.equal(checkInstallCommand('npm install zod'), null);
  assert.equal(checkInstallCommand('npx tsx scripts/a.ts'), null);
});

test('migration path: name, taken number and applied files', () => {
  const dir = 'packages/db/schema/supabase/';
  assert.equal(checkMigrationPath(`${dir}190_x.sql`, migCtx()).decision, 'deny');
  assert.equal(checkMigrationPath(`${dir}0190_CamelCase.sql`, migCtx()).decision, 'deny');
  assert.equal(checkMigrationPath(`${dir}0190_x.sql`, migCtx({ takenNumbers: new Map([['0190', '0190_y.sql on main']]) })).decision, 'deny');
  assert.equal(checkMigrationPath(`${dir}0185_x.sql`, migCtx({ exists: true, onMain: true })).decision, 'ask');
  assert.equal(checkMigrationPath(`${dir}0190_new_thing.sql`, migCtx()), null);
  assert.equal(checkMigrationPath('lib/a.sql', migCtx()), null);
});

test('migration lint: flags the missing guards', () => {
  const findings = lintMigration(`
    CREATE TABLE public.things (id INT);
    CREATE FUNCTION public.do_thing() RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
  `).join('\n');
  assert.match(findings, /SECURITY DEFINER without SET search_path/);
  assert.match(findings, /REVOKE ALL ON FUNCTION/);
  assert.match(findings, /without OR REPLACE/);
  assert.match(findings, /IF NOT EXISTS/);
  assert.match(findings, /no ENABLE ROW LEVEL SECURITY/);
  assert.match(findings, /no FORCE ROW LEVEL SECURITY/);
});

test('migration lint: a well-formed migration is clean', () => {
  assert.deepEqual(
    lintMigration(`
      CREATE TABLE IF NOT EXISTS public.things (id INT);
      ALTER TABLE public.things ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.things FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON public.things FROM PUBLIC, anon, authenticated;
      -- SECURITY DEFINER in a comment is ignored
      CREATE OR REPLACE FUNCTION public.do_thing() RETURNS VOID
      LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$ SELECT 1 $$;
      REVOKE ALL ON FUNCTION public.do_thing() FROM PUBLIC, anon, authenticated;
    `),
    []
  );
});

test('git: co-author trailer, env files and the hard wall block a commit', () => {
  assert.equal(checkGitCommand('git commit -m "x\n\nCo-Authored-By: Claude <a@b>"', gitCtx()).decision, 'deny');
  assert.equal(checkGitCommand('git commit -m "x\n\nCo-Authored-By: Claude <a@b>"', gitCtx({ attributionSet: true })), null);
  assert.equal(checkGitCommand('git commit -m x', gitCtx({ stagedFiles: ['.env.local'] })).decision, 'deny');
  assert.equal(checkGitCommand('git commit -m x', gitCtx({ hardWallOutput: 'HARD WALL breach' })).decision, 'deny');
  assert.equal(checkGitCommand('git add .env.production', gitCtx()).decision, 'deny');
  assert.equal(checkGitCommand('git add -A', gitCtx({ untrackedFiles: ['apps/.env'] })).decision, 'deny');
});

test('git: ordinary commands pass', () => {
  assert.equal(checkGitCommand('git add .env.example lib/a.js', gitCtx()), null);
  assert.equal(checkGitCommand('git add -A', gitCtx({ untrackedFiles: ['lib/a.js'] })), null);
  assert.equal(checkGitCommand('git commit -m "feat: x"', gitCtx({ stagedFiles: ['.env.example'] })), null);
  assert.equal(checkGitCommand('git status', gitCtx({ hardWallOutput: 'breach' })), null);
});

test('supabase: production migrations and DDL ask, everything else passes', () => {
  assert.equal(checkSupabaseCall('apply_migration', { project_id: PROD }, PROD).decision, 'ask');
  assert.equal(checkSupabaseCall('execute_sql', { project_id: PROD, query: 'ALTER TABLE public.users ADD COLUMN x INT' }, PROD).decision, 'ask');
  assert.equal(checkSupabaseCall('execute_sql', { project_id: PROD, query: 'UPDATE credit_balances SET balance = 1' }, PROD).decision, 'ask');
  assert.equal(checkSupabaseCall('execute_sql', { project_id: PROD, query: 'SELECT * FROM reconcile_status()' }, PROD), null);
  assert.equal(checkSupabaseCall('apply_migration', { project_id: 'staging' }, PROD), null);
  assert.equal(checkSupabaseCall('apply_migration', { project_id: PROD }, null), null);
});

test('the production ref is the first SUPABASE_URL in wrangler.jsonc', () => {
  assert.equal(prodRefFromWrangler('"SUPABASE_URL": "https://abc123.supabase.co",\n"env": {"SUPABASE_URL": "https://zzz.supabase.co"}'), 'abc123');
  assert.equal(prodRefFromWrangler('{}'), null);
});

test('pre-tool runner: denies through the hook protocol and stays silent on allow', () => {
  const runHook = (payload) =>
    execFileSync('node', ['.claude/hooks/veyrnox/pre-tool.mjs'], { input: JSON.stringify(payload), encoding: 'utf8' });
  const denied = JSON.parse(
    runHook({ tool_name: 'Write', tool_input: { file_path: `${process.cwd()}/lib/x.js`, content: "import a from 'jose'" } })
  );
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(runHook({ tool_name: 'Write', tool_input: { file_path: `${process.cwd()}/lib/x.js`, content: 'export const a = 1' } }), '');
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'ls' } }), '');
});
