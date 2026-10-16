import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('provider monitoring runs when its switch is absent and only explicit false pauses it', () => {
    const source = readFileSync(new URL('../.github/workflows/provider-balances.yml', import.meta.url), 'utf8');
    assert.match(source, /if: vars\.PROVIDER_BALANCE_WATCH_ENABLED != 'false' && github\.ref == 'refs\/heads\/main'/);
    assert.match(source, /FAL_BILLING_KEY: \$\{\{ secrets\.FAL_BILLING_KEY \}\}/);
    assert.match(source, /OPENROUTER_MANAGEMENT_KEY: \$\{\{ secrets\.OPENROUTER_MANAGEMENT_KEY \}\}/);
});

test('the secret gate scans full history and verifies deleted-credential detection without credentials', () => {
    const source = readFileSync(new URL('../.github/workflows/secret-scan.yml', import.meta.url), 'utf8');
    assert.match(source, /fetch-depth: 0/);
    assert.match(source, /persist-credentials: false/);
    assert.match(source, /sha256sum --check/);
    assert.match(source, /scripts\/test-secret-scanner\.mjs/);
    assert.match(source, /--redact=100 --log-opts=--all/);
    assert.doesNotMatch(source, /secrets\./);
});
