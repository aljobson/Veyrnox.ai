import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const copies = JSON.parse(await readFile(new URL('./uuidCopies.fixture.json', import.meta.url)));
const corpus = [
    ['', false, false], [null, false, false], [undefined, false, false], [123, false, false],
    ['550e8400-e29b-41d4-a716-446655440000', true, true],
    ['550E8400-E29B-41D4-A716-446655440000', true, true],
    ['550e8400-e29b-71d4-a716-446655440000', false, true],
    ['550e8400-e29b-01d4-a716-446655440000', false, true],
    ['550e8400-e29b-41d4-7716-446655440000', false, true],
    ['550e8400-e29b-41d4-a716-446655440000\n', false, false],
    [' 550e8400-e29b-41d4-a716-446655440000', false, false],
    ['550g8400-e29b-41d4-a716-446655440000', false, false],
    ['550e8400e29b41d4a716446655440000', false, false],
];
for (const [file, name, helper] of copies) {
    test(`${file}: ${name} preserves ${helper} validation`, async () => {
        const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        const original = source.match(new RegExp(`const ${name}\\s*=\\s*(/[^\\n]+?/[ig]*);`));
        let validate;
        if (original) { const regex = Function(`return ${original[1]}`)(); validate = value => regex.test(value); }
        else {
            assert.match(source, new RegExp(`import \\{ ${helper} \\} from ['"][^'"]*validate.js['"]`));
            assert.ok(source.includes(`${helper}(`));
            validate = (await import('../lib/validate.js'))[helper];
        }
        for (const [value, strict, loose] of corpus) assert.equal(validate(value), helper === 'isUuid' ? strict : loose, String(value));
        for (const version of [1, 2, 3, 4, 5]) for (const variant of ['8', '9', 'a', 'b']) {
            assert.equal(validate(`550e8400-e29b-${version}1d4-${variant}716-446655440000`), true);
        }
    });
}
