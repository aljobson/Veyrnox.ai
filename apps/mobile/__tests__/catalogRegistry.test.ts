import en from '../src/lib/i18n/messages/en';
import order from '../src/lib/i18n/messages/en/_order';
declare const require: (name: string) => any;
declare const __dirname: string;
const { execFileSync } = require('child_process');
const { join } = require('path');
const { createHash } = require('crypto');
const root = join(__dirname, '..');

test('generated English registry matches the area directory', () => {
    expect(execFileSync('node', ['scripts/gen-en-registry.mjs', '--check'], { cwd: root, encoding: 'utf8' })).toContain('current');
});
test('historical English key order survives the split unchanged', () => {
    // Pins KEY ORDER only. A later edit of a string value must never fail a test; values were proven equal once, at the split.
    const original = Object.keys(en).filter((key) => (order as readonly string[]).includes(key));
    expect(original).toEqual(order);
    expect(createHash('sha256').update(JSON.stringify(order)).digest('hex')).toBe('e3ad97a280093c32d6b6b9232132b92ed28b0071c8419ec84689792fc38375c2');
});
test('the sync reader and runtime catalog agree on every key, value and order', () => {
    const result = execFileSync('node', ['--input-type=module', '-e',
        "import { readEnglishCatalog } from './scripts/sync-web-i18n.mjs'; console.log(JSON.stringify(Object.entries(readEnglishCatalog())));",
    ], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(result)).toEqual(Object.entries(en));
});
test('readEnglishCatalog does not throw and retains the sum of all area key counts', () => {
    const readEnglishCatalog = () => JSON.parse(execFileSync('node', ['--input-type=module', '-e',
        "import { readEnglishCatalog } from './scripts/sync-web-i18n.mjs'; console.log(JSON.stringify(readEnglishCatalog()));",
    ], { cwd: root, encoding: 'utf8' })) as Record<string, string>;
    let catalog: Record<string, string> = {};
    expect(() => { catalog = readEnglishCatalog(); }).not.toThrow();
    const directory = join(root, 'src/lib/i18n/messages/en');
    const files: string[] = require('fs').readdirSync(directory);
    const areaKeyCount = files.filter(file => !file.startsWith('_') && file.endsWith('.ts'))
        .reduce((count, file) => count + Object.keys(require(join(directory, file)).default).length, 0);
    expect(Object.keys(catalog)).toHaveLength(areaKeyCount);
});
test('catalog evaluation preserves literal as const text and names a malformed area file', () => {
    execFileSync('node', ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        import { readEnglishCatalog } from './scripts/sync-web-i18n.mjs';
        const directory = mkdtempSync(join(tmpdir(), 'english-reader-'));
        try {
            writeFileSync(join(directory, '_order.ts'), 'export default [] as const;\\n');
            const file = join(directory, 'sample.ts');
            for (const source of [
                "export default { 'sample.text': 'Keep as const and } as const; literally' } as const;\\n",
                "const sample = { 'sample.text': 'Keep as const and } as const; literally' } as const;\\nexport default sample;\\n",
            ]) {
                writeFileSync(file, source);
                assert.equal(readEnglishCatalog(directory)['sample.text'], 'Keep as const and } as const; literally');
            }
            writeFileSync(file, "export default { 'sample.text': missingValue } as const;\\n");
            assert.throws(() => readEnglishCatalog(directory), error =>
                error.message.includes('Failed to evaluate English area file') &&
                error.message.includes(file) &&
                error.message.includes('missingValue'));
        } finally { rmSync(directory, { recursive: true, force: true }); }
    `], { cwd: root, encoding: 'utf8' });
});
test('area files accept trailing comments and blank lines without changing literal strings', () => {
    execFileSync('node', ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
        import { tmpdir } from 'node:os';
        import { join } from 'node:path';
        import { readEnglishCatalog } from './scripts/sync-web-i18n.mjs';
        const directory = mkdtempSync(join(tmpdir(), 'english-comments-'));
        try {
            writeFileSync(join(directory, '_order.ts'), 'export default [] as const;\\n');
            const value = 'Keep } as const; // literally';
            const source = "export default { 'sample.text': " + JSON.stringify(value) + " } as const;";
            for (const trailing of [
                '\\n\\n// trailing comment',
                ' // inline comment\\n\\n',
                '\\n/* multiline\\ncomment with } as const; */\\n',
                '\\n// first comment\\n/* second comment */\\n\\n',
            ]) {
                writeFileSync(join(directory, 'sample.ts'), source + trailing);
                assert.deepEqual(readEnglishCatalog(directory), { 'sample.text': value });
            }
        } finally { rmSync(directory, { recursive: true, force: true }); }
    `], { cwd: root, encoding: 'utf8' });
});
