import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
for (const file of ['app/api/v1/top-ups/route.js', 'app/api/v1/admin/violations/route.js']) {
    test(`${file}: idempotency length and alphabet remain unchanged`, async () => {
        const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        const original = source.match(/const IDEMPOTENCY_RE = (\/[^\n]+\/);/);
        let regex;
        if (original) regex = Function(`return ${original[1]}`)();
        else {
            assert.match(source, /import \{ IDEMPOTENCY_RE \} from ['"][^'"]*idempotency.js['"]/);
            regex = (await import('../lib/idempotency.js')).IDEMPOTENCY_RE;
        }
        for (const [input, expected] of [['', false], ['a'.repeat(7), false], ['a'.repeat(8), true], ['a'.repeat(128), true], ['a'.repeat(129), false], ['AZ09._-a', true], ['a b12345', false], ['é1234567', false], ['12345678\n', false], [null, false]]) assert.equal(regex.test(input), expected);
    });
}
