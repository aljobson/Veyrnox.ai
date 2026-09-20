import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// packages/db/ledger.ts is the legacy gateway-v1 ledger: raw INSERT INTO
// ledger_entries with no free_delta. Wired into a request path it would break
// the Free Credits invariant on the first debit. It exists only so the
// acceptance suite can drive a real Postgres through it, so this asserts it
// never escapes that role — the audit flagged it as a live trap, and a
// comment alone does not stop an import.

const ROOT = new URL('..', import.meta.url).pathname;
const SEARCH = ['app', 'lib', 'components', 'packages/adapters', 'packages/catalog', 'scripts'];

function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        if (e === 'node_modules' || e.startsWith('.')) continue;
        const full = join(dir, e);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(e)) out.push(full);
    }
    return out;
}

test('no application code imports the legacy Ledger class', () => {
    const offenders = [];
    for (const rel of SEARCH) {
        for (const file of walk(join(ROOT, rel))) {
            const src = readFileSync(file, 'utf8');
            // Match an import of the module, not the word "ledger" — the RPC
            // names legitimately contain it all over the codebase.
            if (/from\s+['"][^'"]*db\/ledger(\.ts)?['"]/.test(src) || /require\(\s*['"][^'"]*db\/ledger/.test(src)) {
                offenders.push(file.replace(ROOT, ''));
            }
        }
    }
    assert.deepEqual(offenders, [],
        'packages/db/ledger.ts writes no free_delta; production must use the RPCs');
});

// packages/db/index.ts was a single line — `export { Ledger } from "./ledger.ts"`
// — with no importers anywhere. Its only effect was to make the legacy class
// reachable from the package root, so it was deleted rather than kept.
test('the class is still only reachable from its own acceptance test', () => {
    const dbDir = join(ROOT, 'packages/db');
    const importers = readdirSync(dbDir)
        .filter((f) => /\.(ts|js|mjs)$/.test(f))
        .filter((f) => /from\s+['"]\.\/ledger(\.ts)?['"]/.test(readFileSync(join(dbDir, f), 'utf8')));
    for (const f of importers) {
        assert.match(f, /\.test\.ts$/, `${f} imports the legacy Ledger but is not a test`);
    }
});
