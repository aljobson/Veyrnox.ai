// Pure checks behind the Veyrnox.ai Claude Code hooks. Each returns null or
// { decision: 'deny' | 'ask', reason }. No I/O here: the runners pass in
// whatever needs the disk, git or the network.

const deny = (reason) => ({ decision: 'deny', reason });
const ask = (reason) => ({ decision: 'ask', reason });

const MIGRATION_DIR = 'packages/db/schema/supabase/';
const MIGRATION_NAME_RE = /^\d{4}_[a-z0-9]+(_[a-z0-9]+)*\.sql$/;

const isTestPath = (rel) =>
  /(^|\/)tests?\//.test(rel) || /\.test\.[a-z]+$/.test(rel) || /^scripts\/test-/.test(rel);

// packages/db holds the migrations and the legacy test harness (ledger.ts,
// queries/*.sql); raw ledger SQL is expected there and nowhere else.
const isMoneyGuarded = (rel) => !rel.startsWith('packages/db/') && !isTestPath(rel);

const RAW_LEDGER_WRITES = [
  [/\binsert\s+into\s+(public\.)?ledger_entries\b/i, 'a raw INSERT INTO ledger_entries'],
  [/\b(update|delete\s+from)\s+(only\s+)?(public\.)?ledger_entries\b/i, 'an UPDATE or DELETE on ledger_entries (the ledger is append-only)'],
  [/\b(insert\s+into|update|delete\s+from)\s+(only\s+)?(public\.)?credit_balances\b/i, 'a raw write to credit_balances'],
  [/\bset\b[^;]*\bfrozen_at\s*=/i, 'a direct write to users.frozen_at'],
];

export function checkMoneySpine(rel, text) {
  if (!isMoneyGuarded(rel)) return null;
  for (const [re, what] of RAW_LEDGER_WRITES) {
    if (re.test(text)) {
      return deny(
        `${rel}: this adds ${what}. Balances and freezes move only through the ledger RPCs ` +
          '(ledger_debit, ledger_refund, ledger_grant, apply_top_up_refund, unfreeze_account, ...). See CLAUDE.md, Database.'
      );
    }
  }
  return null;
}

const SSR_PATH_RE = /^(app|components|lib|packages)\/|^middleware\.js$/;
const TRAP_IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](jose|@supabase\/supabase-js)(?:\/[^'"]*)?['"]/;

export function checkBundlerTraps(rel, text) {
  if (rel === 'package.json' && /"tsx"\s*:/.test(text)) {
    return deny('package.json: tsx in the root dependencies breaks Cloudflare Workers Builds. Install it ad hoc in CI (npm i --no-save tsx).');
  }
  if (!SSR_PATH_RE.test(rel) || isTestPath(rel)) return null;
  const hit = text.match(TRAP_IMPORT_RE);
  if (!hit) return null;
  const fix =
    hit[1] === 'jose'
      ? 'Verify with Web Crypto (crypto.subtle.importKey / verify) instead.'
      : 'Use plain fetch against /auth/v1/* and /rest/v1/* instead.';
  return deny(`${rel}: importing ${hit[1]} on the SSR import graph breaks Cloudflare Workers Builds. ${fix}`);
}

const NPM_INSTALL_RE = /\b(?:npm\s+(?:i|install|add)|pnpm\s+add|yarn\s+add|bun\s+add)\b([^|;&\n]*)/g;

export function checkInstallCommand(command) {
  for (const [, args] of command.matchAll(NPM_INSTALL_RE)) {
    if (/--no-save\b/.test(args)) continue;
    const hit = args.match(/(?:^|\s)(tsx|jose|@supabase\/supabase-js)(?:@\S+)?(?=\s|$)/);
    if (hit) {
      return deny(`Installing ${hit[1]} into package.json breaks Cloudflare Workers Builds (CLAUDE.md, Bundler traps). Use --no-save for a one-off.`);
    }
  }
  return null;
}

// ctx: { exists, onMain, takenNumbers: Map<number, where> }
export function checkMigrationPath(rel, ctx) {
  if (!rel.startsWith(MIGRATION_DIR) || !rel.endsWith('.sql')) return null;
  const name = rel.slice(MIGRATION_DIR.length);
  if (!MIGRATION_NAME_RE.test(name)) {
    return deny(`${name}: migrations are named NNNN_<snake_case>.sql directly under ${MIGRATION_DIR}.`);
  }
  if (ctx.onMain) {
    return ask(`${name} is already on main, so it is probably applied. Applied migrations stay unchanged; a fix goes in a new migration.`);
  }
  if (!ctx.exists) {
    const where = ctx.takenNumbers.get(name.slice(0, 4));
    if (where) return deny(`Migration number ${name.slice(0, 4)} is already taken (${where}). Take the next free number.`);
  }
  return null;
}

const splitFunctions = (sql) => sql.split(/\bcreate\s+(?:or\s+replace\s+)?function\b/i).slice(1);

// Advisory findings for a whole migration file, after it is written.
export function lintMigration(sql) {
  const body = sql.replace(/--[^\n]*/g, '');
  const findings = [];
  for (const chunk of splitFunctions(body)) {
    const name = (chunk.match(/^\s*([\w."]+)/) || [])[1] || '?';
    const head = chunk.split(/\bAS\s+\$/i)[0];
    if (/\bsecurity\s+definer\b/i.test(head) && !/\bset\s+search_path\s*(=|to)\s*''/i.test(head)) {
      findings.push(`${name}: SECURITY DEFINER without SET search_path = ''.`);
    }
  }
  // Revokes are often issued in a loop over a name list, so this is per file.
  if (splitFunctions(body).length > 0 && !/\brevoke\s+all\s+on\s+function\b/i.test(body)) {
    findings.push('Functions are created but nothing runs REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated. Needed whenever a signature is new.');
  }
  if (/\bcreate\s+function\b/i.test(body) && !/\bdrop\s+function\b/i.test(body)) {
    findings.push('CREATE FUNCTION without OR REPLACE (or a guarded DROP) is not replay-safe.');
  }
  for (const [, table] of body.matchAll(/\bcreate\s+table\s+(?!if\s+not\s+exists)([\w."]+)/gi)) {
    findings.push(`${table}: CREATE TABLE without IF NOT EXISTS is not replay-safe.`);
  }
  for (const [, table] of body.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) {
    const t = table.replace(/"/g, '').replace(/[.]/g, '\\.');
    if (!new RegExp(`${t}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(body)) findings.push(`${table}: no ENABLE ROW LEVEL SECURITY.`);
    if (!new RegExp(`${t}\\s+force\\s+row\\s+level\\s+security`, 'i').test(body)) findings.push(`${table}: no FORCE ROW LEVEL SECURITY.`);
    if (!new RegExp(`\\brevoke\\s+all\\s+on\\s+[^;]*${t}\\b`, 'i').test(body)) findings.push(`${table}: no REVOKE ALL ... FROM PUBLIC, anon, authenticated.`);
  }
  return findings;
}

const GIT_COMMIT_RE = /\bgit\b[^|;&\n]*\bcommit\b/;
const GIT_ADD_RE = /\bgit\b[^|;&\n]*\badd\b([^|;&\n]*)/;
const isSecretEnvFile = (path) => /(^|\/)\.env(\.[^/]*)?$/.test(path) && !/\.env\.example$/.test(path);

// ctx: { attributionSet, stagedFiles: string[], untrackedFiles: string[], hardWallOutput: string | null }
export function checkGitCommand(command, ctx) {
  const add = command.match(GIT_ADD_RE);
  if (add) {
    const named = add[1].split(/\s+/).find(isSecretEnvFile);
    if (named) return deny(`${named} must never be committed (CLAUDE.md, Ground rules).`);
    if (/(^|\s)(-A|--all|\.)(\s|$)/.test(add[1])) {
      const loose = ctx.untrackedFiles.find(isSecretEnvFile);
      if (loose) return deny(`git add would stage ${loose}. Add files by name, or ignore it first.`);
    }
  }
  if (!GIT_COMMIT_RE.test(command)) return null;
  if (!ctx.attributionSet && /co-authored-by:/i.test(command)) {
    return deny('No Co-Authored-By trailer on commits in this repo unless attribution.commit is set in .claude/settings.json.');
  }
  const staged = ctx.stagedFiles.find(isSecretEnvFile);
  if (staged) return deny(`${staged} is staged. Unstage it: env files must never be committed.`);
  if (ctx.hardWallOutput) return deny(`Hard wall check failed; fix before committing.\n${ctx.hardWallOutput}`);
  return null;
}

const DDL_RE = /\b(create|alter|drop|truncate|grant|revoke)\s+(or\s+replace\s+)?(table|function|policy|trigger|index|schema|role|type|view|extension|all|execute|select|insert|update|delete|usage|sequence|materialized)\b/i;

// toolName is the part after the server prefix: apply_migration | execute_sql.
export function checkSupabaseCall(toolName, input, prodRef) {
  if (!prodRef || input.project_id !== prodRef) return null;
  if (toolName === 'apply_migration') {
    return ask('apply_migration on PRODUCTION. Production migrations go through the apply-migrations workflow (ADR-0023) unless the owner has said in chat that it cannot be used.');
  }
  const sql = String(input.query || '');
  if (DDL_RE.test(sql)) return ask('DDL through execute_sql on PRODUCTION. Schema changes are migrations in git, applied by the apply-migrations workflow.');
  const raw = RAW_LEDGER_WRITES.find(([re]) => re.test(sql));
  if (raw) return ask(`execute_sql on PRODUCTION contains ${raw[1]}. Money moves only through the ledger RPCs.`);
  return null;
}

export function prodRefFromWrangler(text) {
  const hit = text.match(/"SUPABASE_URL"\s*:\s*"https:\/\/([a-z0-9]+)\.supabase\.co"/);
  return hit ? hit[1] : null;
}
