import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { FAL_BILLING_URL, KIE_CREDIT_URL, OPENROUTER_CREDITS_URL } from '../scripts/lib/provider-balances.mjs';

// The real script, start to finish, with the network replaced by
// tests/fixtures/provider-balances-fetch.mjs.
const script = fileURLToPath(new URL('../scripts/check-provider-balances.mjs', import.meta.url));
const stub = new URL('./fixtures/provider-balances-fetch.mjs', import.meta.url).href;
const KEYS = { FAL_BILLING_KEY: 'fal-test-key-1234', KIE_BALANCE_API_KEY: 'kie-test-key-1234', OPENROUTER_MANAGEMENT_KEY: 'or-test-key-1234' };

const fine = {
    [FAL_BILLING_URL]: { body: { username: 't', credits: { current_balance: 61.25, currency: 'USD' } } },
    [KIE_CREDIT_URL]: { body: { code: 200, msg: 'success', data: 12345 } },
    [OPENROUTER_CREDITS_URL]: { body: { data: { total_credits: 100, total_usage: 70 } } },
};

function run(answers, { env = {}, args = [] } = {}) {
    const out = spawnSync(process.execPath, ['--import', stub, script, ...args], {
        env: { PATH: process.env.PATH, ...KEYS, ...env, PROVIDER_BALANCE_STUB: JSON.stringify(answers) },
        encoding: 'utf8',
    });
    return { status: out.status, stdout: out.stdout, all: out.stdout + out.stderr };
}

test('all above floor: exit 0, verdicts only, no key and no figure in the output', () => {
    const out = run(fine);
    assert.equal(out.status, 0, out.all);
    assert.deepEqual(out.stdout.trimEnd().split('\n'), [
        'provider balances',
        '  ok         fal        above floor 20 USD',
        '  ok         kie        above floor 4000 credits',
        '  ok         openrouter above floor 10 USD',
        '',
        'Every balance is above its floor.',
    ]);
    for (const key of Object.values(KEYS)) assert.ok(!out.all.includes(key), 'a key must never be printed');
    for (const figure of ['61.25', '12345', '30']) assert.ok(!out.all.includes(figure), `figure ${figure} printed`);
});

test('--show-figures prints the balances for a run at the terminal', () => {
    const out = run(fine, { args: ['--show-figures'] });
    assert.equal(out.status, 0, out.all);
    assert.match(out.stdout, /fal {8}above floor 20 USD \(balance 61\.25 USD\)/);
    assert.match(out.stdout, /openrouter above floor 10 USD \(balance 30 USD\)/);
});

test('a balance at the floor: exit 1 and the floor variable is honoured', () => {
    const out = run(fine, { env: { PROVIDER_BALANCE_FLOOR_KIE_CREDITS: '12345' } });
    assert.equal(out.status, 1, out.all);
    assert.match(out.stdout, /LOW {8}kie {8}at or under floor 12345 credits/);
    assert.match(out.all, /LOW BALANCE: top up/);
});

test('a provider that cannot be read: exit 2, and the message says it is not a pass', () => {
    const out = run({ ...fine, [FAL_BILLING_URL]: { status: 403, body: { error: { type: 'authorization_error', message: 'Access denied' } } } });
    assert.equal(out.status, 2, out.all);
    assert.match(out.stdout, /UNREADABLE fal {8}could not read balance: the key lacks the permission this endpoint needs \(403\)/);
    assert.match(out.all, /COULD NOT READ a balance\. This is not a pass/);
    assert.ok(!out.all.includes('Access denied'), 'vendor text stays out of the report');
});

test('a missing key is unreadable, not skipped', () => {
    const out = run(fine, { env: { OPENROUTER_MANAGEMENT_KEY: '' } });
    assert.equal(out.status, 2, out.all);
    assert.match(out.stdout, /UNREADABLE openrouter could not read balance: no key in the environment/);
});
