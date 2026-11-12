import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const copies = JSON.parse(await readFile(new URL('./rateLimitCopies.fixture.json', import.meta.url)));
for (const [file, expression, maxName, field, fallbackName, max, fallback] of copies) {
    test(`${file}: Retry-After keeps max=${max} fallback=${fallback}`, async () => {
        const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
        let clamp;
        if (source.includes(expression)) {
            clamp = Function('value', `return ${expression.replace(field, 'value').replaceAll(maxName, String(max)).replaceAll(fallbackName, String(fallback))}`);
        } else {
            assert.ok(source.includes(`retryAfterSeconds(${field}, { max: ${maxName}, fallback: ${fallbackName} })`));
            clamp = value => helper(value, { max, fallback });
        }
        const helper = source.includes(expression) ? null : (await import('../lib/rateLimitHeaders.js')).retryAfterSeconds;
        for (const [input, expected] of [[undefined, Math.min(max, fallback)], [null, Math.min(max, fallback)], ['', Math.min(max, fallback)], ['invalid', Math.min(max, fallback)], [0, Math.min(max, fallback)], [-2, 1], [0.5, 1], [1.5, 1.5], ['12', 12], [Infinity, max], [-Infinity, 1], [max + 1, max]]) assert.equal(clamp(input), expected);
    });
}
