// A real historical scan must reject a synthetic credential even after its
// file is deleted. No account or credential is contacted by this fixture.
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const binary = process.argv[2];
if (!binary) throw Error('Gitleaks binary path required');
const dir = mkdtempSync(join(tmpdir(), 'veyrnox-secret-scan-'));
const git = (...args) => {
    const out = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(out.status, 0, 'could not prepare isolated scanner fixture');
};
try {
    git('init', '--quiet');
    git('config', 'user.name', 'Scanner fixture');
    git('config', 'user.email', 'scanner@example.invalid');
    // Recognizable syntax with random bytes, never a valid issued credential.
    writeFileSync(join(dir, 'fixture.txt'), `token=ghp_${randomBytes(20).toString('hex').slice(0, 36)}\n`);
    git('add', 'fixture.txt');
    git('commit', '--quiet', '-m', 'Add synthetic scanner fixture');
    unlinkSync(join(dir, 'fixture.txt'));
    git('add', '-u');
    git('commit', '--quiet', '-m', 'Delete synthetic scanner fixture');
    const out = spawnSync(binary, ['git', '.', '--no-banner', '--redact=100', '--log-opts=--all'], {
        cwd: dir, encoding: 'utf8',
    });
    // Output is intentionally not repeated: regressions must never print the fixture.
    assert.equal(out.status, 1, 'history scan did not reject a credential deleted from the current tree');
    assert.match(out.stderr, /leaks found: [1-9]/, 'scanner did not report a historical finding');
    console.log('Secret scanner regression passed: deleted credential detected.');
} finally {
    rmSync(dir, { recursive: true, force: true });
}
