import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requestCases } from './stripeRequestCases.mjs';
const expected = JSON.parse(await readFile(new URL('./stripeRequests.fixture.json', import.meta.url)));
test('all four Stripe wrappers preserve exact requests and error results from the pre-extraction implementation', async () => {
    const actual = await requestCases();
    for (const [name, result] of Object.entries(expected)) assert.deepEqual(actual[name], result, name);
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
});
