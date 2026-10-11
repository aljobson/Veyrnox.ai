import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalPath, checkoutRoot } from '../.claude/hooks/veyrnox/checkout-root.mjs';
import { checkMoneySpine } from '../.claude/hooks/veyrnox/rules.mjs';
test('migration writes exempt; application writes denied', () => {
    const sql = 'INSERT INTO public.ledger_entries(user_id, delta) VALUES (id, -40);';
    assert.equal(checkMoneySpine('packages/db/schema/supabase/0285_x.sql', sql), null);
    assert.equal(checkMoneySpine('lib/x.js', sql).decision, 'deny');
});
test('target checkout root is resolved inside nested worktree-style paths, with bounded fallback', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-root-')));
    try {
        execFileSync('git', ['init', '-q', root]);
        const nested = join(root, '.claude/worktrees/task'); mkdirSync(join(nested, 'packages/db'), { recursive: true });
        execFileSync('git', ['init', '-q', nested]);
        const target = join(nested, 'packages/db/new.sql');
        assert.equal(relative(checkoutRoot(target, root), target), 'packages/db/new.sql');
        assert.equal(checkoutRoot(join(root, 'missing/file'), root), root);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const missingDirectory of [false, true]) test(`symlinked checkout guards application writes, missing directory: ${missingDirectory}`, () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-symlink-')));
    try {
        const checkout = join(root, 'checkout'), linked = join(root, 'alias');
        mkdirSync(checkout); execFileSync('git', ['init', '-q', checkout]);
        symlinkSync(checkout, linked, 'dir');
        const suffix = missingDirectory ? 'lib/new/deep/file.js' : 'lib/file.js';
        if (!missingDirectory) { mkdirSync(join(checkout, 'lib')); writeFileSync(join(checkout, suffix), ''); }
        const target = join(linked, suffix), canonical = canonicalPath(target);
        assert.equal(relative(checkoutRoot(target, root), canonical), suffix);
        const payload = { tool_name: 'Write', tool_input: { file_path: target,
            content: 'INSERT INTO public.ledger_entries(user_id, delta) VALUES (id, -40);' } };
        const output = execFileSync(process.execPath, ['.claude/hooks/veyrnox/pre-tool.mjs'], {
            input: JSON.stringify(payload), encoding: 'utf8', timeout: 5000,
        });
        assert.equal(JSON.parse(output).hookSpecificOutput.permissionDecision, 'deny');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
test('a new directory resolves to its nested checkout, not the fallback checkout', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'guard-missing-')));
    try {
        execFileSync('git', ['init', '-q', root]);
        const nested = join(root, '.claude/worktrees/task'); mkdirSync(nested, { recursive: true });
        execFileSync('git', ['init', '-q', nested]);
        const target = join(nested, 'packages/db/schema/supabase/new.sql');
        assert.equal(checkoutRoot(target, root), nested);
        assert.equal(relative(checkoutRoot(target, root), canonicalPath(target)), 'packages/db/schema/supabase/new.sql');
    } finally { rmSync(root, { recursive: true, force: true }); }
});
