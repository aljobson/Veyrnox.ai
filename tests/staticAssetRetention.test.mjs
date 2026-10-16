import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retainStaticAssets } from '../scripts/retain-next-static.mjs';

test('retains prior static files without overwriting the current build', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'veyrnox-static-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const prior = join(root, 'prior');
    const current = join(root, 'current');
    await mkdir(join(prior, 'chunks'), { recursive: true });
    await mkdir(join(current, 'chunks'), { recursive: true });
    await writeFile(join(prior, 'chunks', 'old.js'), 'old');
    await writeFile(join(prior, 'chunks', 'shared.js'), 'prior');
    await writeFile(join(current, 'chunks', 'shared.js'), 'current');

    const result = await retainStaticAssets(prior, current);

    assert.deepEqual(result, { copied: 1, preserved: 1 });
    assert.equal(await readFile(join(current, 'chunks', 'old.js'), 'utf8'), 'old');
    assert.equal(await readFile(join(current, 'chunks', 'shared.js'), 'utf8'), 'current');
});

test('rejects symlinks instead of following files outside the artifact tree', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'veyrnox-static-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const prior = join(root, 'prior');
    await mkdir(prior);
    await writeFile(join(root, 'outside.js'), 'outside');
    await symlink(join(root, 'outside.js'), join(prior, 'escape.js'));

    await assert.rejects(retainStaticAssets(prior, join(root, 'current')), /symbolic link/);
});
