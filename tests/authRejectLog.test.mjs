import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The middleware is the edge; its rejections are the only record of a
// forged-token or credential-stuffing burst (audit 2026-09-23, CLAUDE.md
// OWASP #9). Source-level, like the other middleware checks in this suite.
const middleware = readFileSync(new URL('../middleware.js', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const ledgerTests = readFileSync(new URL('../.github/workflows/ledger-tests.yml', import.meta.url), 'utf8');

test('every 401 from the middleware is logged, with a reason and no credential', () => {
    // All three refusal paths go through one logging helper.
    assert.equal((middleware.match(/return reject\(req, /g) || []).length, 3);
    assert.match(middleware, /console\.error\('\[auth\] rejected', new URL\(req\.url\)\.pathname, 'reason:', reason\)/);
    // The 503 path is logged too, and is still not a 401.
    assert.match(middleware, /console\.error\('\[auth\] JWKS unavailable; answering 503'\)/);
    // No jsonError(401 ...) left that skips the helper.
    assert.equal((middleware.match(/jsonError\(401/g) || []).length, 1, 'only the helper answers 401');
    // Never the token or a claim value.
    assert.doesNotMatch(middleware, /console\.error\([^)]*\btoken\b/);
    assert.doesNotMatch(middleware, /console\.error\([^)]*claims\./);
});

test('the secret-logging gate covers console.error, which is what this codebase uses', () => {
    assert.match(ci, /console\\\.\(log\|error\|warn\|info\|debug\)/);
    for (const name of ['kieKey', 'openrouterKey', 'secretAccessKey']) assert.ok(ci.includes(name), name);
    assert.match(ci, /'worker\.js'/);
});

test('the ledger acceptance tests run when the code that calls the RPCs changes', () => {
    for (const path of ['app/api/webhook/**', 'lib/**', 'worker.js']) {
        // Once for the pull_request trigger, once for push.
        assert.equal((ledgerTests.match(new RegExp(`- "${path.replace(/[*.]/g, '\\$&')}"`, 'g')) || []).length, 2, path);
    }
});
