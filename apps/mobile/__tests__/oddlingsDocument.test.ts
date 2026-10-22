import { fitsProject, fromServerDocument, isWellFormedText, jsonbTextBytes, toServerDocument } from '../src/lib/oddlingsDocument';
import { oneLine, sanitizePicks } from '../src/lib/oddlingsBuilder';
import { parseDoc, type Passport, type PassportDoc } from '../src/lib/oddlingsLibrary';
declare const require: (id: string) => any;
declare const __dirname: string;
const { spawnSync } = require('child_process');
const { resolve } = require('path');
const id = '11111111-1111-1111-1111-111111111111';
const item = (n: number): Passport => ({ id: `i-${n}`, name: 'Pip', savedAt: n, motionId: '', picks: { oddling_name: 'Pip' } });
test.each(['abc\uD83D', '\uDE00abc', '\uDE00\uD83D'])('rejects lone surrogate %p', text => expect(isWellFormedText(text)).toBe(false));
test('accepts pairs', () => expect(isWellFormedText('Pip 😀')).toBe(true));
test.each([40, 140, 160])('safe cutting at %i UTF-16 units', max => {
    expect(oneLine('a'.repeat(max - 2) + '😀', max)).toHaveLength(max);
    expect(oneLine('a'.repeat(max - 1) + '😀', max)).toBe('a'.repeat(max - 1));
    expect(isWellFormedText(oneLine('x\uD800x\uDC00', max))).toBe(true);
});
test('sanitizes names and repairs legacy ids, dates and duplicate ids', () => {
    const doc = parseDoc(JSON.stringify({ version: 1, items: [
        { id: 'bad/id', savedAt: -1.5, picks: { oddling_name: 'Pip\uD83D' } },
        { id: 'bad/id', savedAt: 1e15, picks: { oddling_name: 'a'.repeat(39) + '😀' } },
    ], draft: null }));
    expect(doc.items.map(i => i.id)).toEqual(['bad-id', 'bad-id-1']);
    expect(doc.items.map(i => i.savedAt)).toEqual([1e14, 0]);
    expect(doc.items[1].name).toBe('Pip\uFFFD'); expect(fitsProject(doc)).toBe(true);
    expect(sanitizePicks({ oddling_name: 'a'.repeat(39) + '😀' }).oddling_name).toHaveLength(39);
});
test('jsonb separator spaces are counted', () => {
    expect(jsonbTextBytes({ a: 1, b: [1, 2] })).toBe(21);
    expect(jsonbTextBytes({})).toBe(2); expect(jsonbTextBytes(['😀'])).toBe(8);
});
function sized(target: number): PassportDoc {
    const items = Array.from({ length: 4 }, (_, n) => ({ ...item(n), picks: Object.fromEntries(Array.from({ length: 64 }, (_, k) => [`p_${String.fromCharCode(97 + Math.floor(k / 26))}${String.fromCharCode(97 + k % 26)}`, 'x'])) }));
    const doc = { items, draft: null };
    let remaining = target - jsonbTextBytes(toServerDocument(id, doc));
    for (const i of items) for (const key of Object.keys(i.picks)) {
        const add = Math.min(159, remaining); i.picks[key] += 'x'.repeat(add); remaining -= add;
    }
    expect(remaining).toBe(0); return doc;
}
test('phone verdict and bytes match the actual server validator, including exact limits', () => {
    const docs: PassportDoc[] = [{ items: [], draft: null }, { items: Array.from({ length: 24 }, (_, n) => item(n)), draft: null },
        sized(32768), sized(32769), { items: [{ ...item(0), name: 'Pip 😀' }], draft: null },
        { items: [{ ...item(0), name: '\uD83D' }], draft: null }, { items: [{ ...item(0), name: 'bad\nname' }], draft: null }];
    const values = docs.map(d => toServerDocument(id, d));
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `import { validOddlingsProjectDocument as valid, jsonbTextBytes as bytes } from ${JSON.stringify(resolve(__dirname, '../../../lib/projectOddlingsDocument.js'))};
        let input = ''; for await (const part of process.stdin) input += part;
        console.log(JSON.stringify(JSON.parse(input).map(d => [valid(d, d.project_id), bytes(d)])));`], { input: JSON.stringify(values), encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    expect(run.status).toBe(0); expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toEqual(docs.map((doc, n) => [fitsProject(doc, id), jsonbTextBytes(values[n])]));
    expect(docs.map(d => fitsProject(d, id))).toEqual([true, true, true, false, true, false, false]);
});
test('only revision zero is empty; malformed v4 and other kinds are not Oddlings', () => {
    expect(fromServerDocument({ revision: 0, document: { schema_version: 1 } })).toEqual({ kind: 'empty' });
    expect(fromServerDocument({ revision: 1, document: { schema_version: 1 } })).toEqual({ kind: 'other' });
    expect(fromServerDocument({ revision: 1, document: { schema_version: 4 } })).toEqual({ kind: 'other' });
});

test.each([['oddling_name', 40], ['oddling_obsession', 140], ['oddling_rule', 160]] as const)('sanitizePicks cuts %s safely', (key, max) => {
    const out = sanitizePicks({ [key]: 'a'.repeat(max - 1) + '😀' });
    expect(out[key]).toHaveLength(max - 1); expect(isWellFormedText(out[key])).toBe(true);
});
