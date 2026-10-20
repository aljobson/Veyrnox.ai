export {};
declare const require: (name: string) => any;
declare const __dirname: string;
const { execFileSync } = require('child_process');
const { join } = require('path');
const root = join(__dirname, '../../..');
// Use native ESM in Node: importing tooling must not write files, or require the mobile runtime.
function run(source: string) {
    return execFileSync('node', ['--input-type=module', '-e', source], { cwd: root, encoding: 'utf8' });
}
test('ADR baseline and historical README stay frozen; every numbered filename remains discoverable', () => {
    run(`
        import assert from 'node:assert/strict';
        import { createHash } from 'node:crypto';
        import { readFileSync } from 'node:fs';
        import { readIndex, renderIndex, validateIndex, cutoff } from './scripts/adr-index.mjs';
        const hash = text => createHash('sha256').update(text).digest('hex');
        const {readme, baseline, entries} = readIndex();
        const frozenMessage = 'docs/adr/README.md and docs/adr/index-baseline.txt are frozen. Remove your edits and add a standalone ADR file (see docs/agents/domain.md).';
        assert.equal(hash(readme.replace(cutoff, '')), 'd303543a2f8062eec0732785d273479ff2e28453a46f1a2580a9425104c6eabd', frozenMessage);
        assert.equal(hash(readFileSync('docs/adr/index-baseline.txt')), '7ca4f474432a335b5429ebb5f3188c9414fa254b227a900dfefa4f71e93ff064', frozenMessage);
        assert.deepEqual(validateIndex(), []);
        const output = renderIndex();
        for (const entry of entries) assert.ok(output.includes('](' + entry.filename + ')'), entry.filename);
        for (const filename of baseline.filter(name => /^\\d+-/.test(name))) assert.ok(entries.some(e => e.filename === filename), filename);
        // All grandfathered omissions, including bullet-only 0081/0082; formatting exemptions never hide files.
        const grandfathered = ["0067-amendment-16-parallel-search.md", "0081-cinema-community-votes-comments.md", "0082-credit-subscription-ui.md", "0101-developer-api-and-cli.md", "0102-browser-refresh-cookie.md", "0136-mobile-publish-connect-return.md", "0153-mobile-create-options.md", "0156-mobile-library-parity.md", "0157-mobile-edit-sound-and-stems.md", "0158-mobile-oddlings.md", "0170-sentry-worker-error-reporting.md"];
        for (const filename of grandfathered) assert.ok(output.includes('](' + filename + ')'), filename);
    `);
});
test('new files are validated by filename, including low-numbered amendments, and appear without README edits', () => {
    run(`
        import assert from 'node:assert/strict';
        import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        import { validateIndex, renderIndex } from './scripts/adr-index.mjs';
        const dir = mkdtempSync(join(tmpdir(), 'adr-index-'));
        try {
            writeFileSync(join(dir, 'README.md'), '# ADRs\\n');
            writeFileSync(join(dir, 'index-baseline.txt'), '0067-old.md\\n');
            writeFileSync(join(dir, '0067-old.md'), 'Legacy with no heading or status');
            writeFileSync(join(dir, '0067-new-amendment.md'), 'Missing both');
            assert.equal(validateIndex(dir).length, 2);
            writeFileSync(join(dir, '0067-new-amendment.md'), '# ADR-0067 amendment: Example\\n**Status**: Proposed\\n');
            assert.deepEqual(validateIndex(dir), []);
            const index = renderIndex(dir);
            for (const name of ['0067-old.md', '0067-new-amendment.md']) assert.ok(index.includes('](' + name + ')'));
            assert.ok(index.includes('ADR-0067 amendment: Example'));
            assert.ok(index.includes('Proposed'));
        } finally { rmSync(dir, { recursive: true, force: true }); }
    `);
});
test('two non-baseline ADRs with the same number warn on stderr without failing validation', () => {
    run(`
        import assert from 'node:assert/strict';
        import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        import { spawnSync } from 'node:child_process';
        const dir = mkdtempSync(join(tmpdir(), 'adr-duplicate-'));
        const check = () => {
            const result = spawnSync(process.execPath, ['--input-type=module', '-e',
                "import { validateIndex } from './scripts/adr-index.mjs'; console.log(JSON.stringify(validateIndex(" + JSON.stringify(dir) + ")));",
            ], { encoding: 'utf8' });
            assert.equal(result.status, 0, result.stderr);
            assert.deepEqual(JSON.parse(result.stdout), []);
            return result.stderr;
        };
        try {
            writeFileSync(join(dir, 'README.md'), '# ADRs\\n');
            writeFileSync(join(dir, 'index-baseline.txt'), '0067-old.md\\n0067-old-amendment.md\\n');
            for (const name of ['0067-old.md', '0067-old-amendment.md']) writeFileSync(join(dir, name), 'Legacy');
            const first = '0067-new-first.md';
            const later = '0067-new-second.md';
            writeFileSync(join(dir, first), '# First\\nStatus: Proposed\\n');
            // One new amendment sharing a baseline number remains valid.
            assert.equal(check(), '');
            writeFileSync(join(dir, later), '# Second\\nStatus: Proposed\\n');
            const warning = check();
            assert.match(warning, /WARNING:/);
            assert.ok(warning.includes(first));
            assert.ok(warning.includes(later));
            renameSync(join(dir, later), join(dir, '0068-new-second.md'));
            assert.equal(check(), '');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    `);
});
