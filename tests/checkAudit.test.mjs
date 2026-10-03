import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXCEPTIONS, highAdvisories, judgeAudit, main } from '../scripts/check-audit.mjs';

// Shaped like `npm audit --json` (npm 11): the advisory is the object in
// `via`; packages that only depend on it carry strings.
const advisory = (name, ghsa, severity = 'high') => ({
    source: 1, name, dependency: name, title: `${name} problem`, url: `https://github.com/advisories/${ghsa}`, severity, range: '*',
});
const report = (...advisories) => ({
    vulnerabilities: {
        ...Object.fromEntries(advisories.map((a) => [a.name, { name: a.name, severity: a.severity, isDirect: false, via: [a] }])),
        tailwindcss: { name: 'tailwindcss', severity: 'high', isDirect: true, via: advisories.map((a) => a.name) },
    },
    metadata: {},
});
const BRACES = advisory('braces', 'GHSA-vfj7-8cjw-p6xm');
const CLEAN = { vulnerabilities: {}, metadata: {} };
const NOW = Date.parse('2026-10-03T06:00:00Z');
const EX = [{ id: 'GHSA-vfj7-8cjw-p6xm', package: 'braces', reason: 'r', reviewBy: '2026-11-02' }];

test('an advisory is counted once, not once per package that depends on it', () => {
    const found = highAdvisories(report(BRACES));
    assert.equal(found.length, 1);
    assert.deepEqual([found[0].id, found[0].package], ['GHSA-VFJ7-8CJW-P6XM', 'braces']);
    assert.deepEqual(highAdvisories(report(advisory('x', 'GHSA-aaaa-bbbb-cccc', 'moderate'))), []);
    assert.deepEqual(highAdvisories(null), []);
});

test('a listed, build-only, unexpired advisory passes; anything else blocks', () => {
    const ok = judgeAudit({ full: report(BRACES), prod: CLEAN, exceptions: EX, nowMs: NOW });
    assert.equal(ok.blocking.length, 0);
    assert.equal(ok.excepted.length, 1);
    assert.equal(ok.excepted[0].daysLeft, 30);

    const other = advisory('left-pad', 'GHSA-1111-2222-3333', 'critical');
    const mixed = judgeAudit({ full: report(BRACES, other), prod: CLEAN, exceptions: EX, nowMs: NOW });
    assert.deepEqual(mixed.blocking.map((b) => [b.package, b.why]), [['left-pad', 'no exception']]);

    // Same advisory id on a different package is not covered.
    const moved = judgeAudit({ full: report(advisory('micromatch', 'GHSA-vfj7-8cjw-p6xm')), prod: CLEAN, exceptions: EX, nowMs: NOW });
    assert.equal(moved.blocking.length, 1);
});

test('an exception never covers an advisory that reaches production dependencies', () => {
    const v = judgeAudit({ full: report(BRACES), prod: report(BRACES), exceptions: EX, nowMs: NOW });
    assert.equal(v.excepted.length, 0);
    assert.match(v.blocking[0].why, /reaches production dependencies/);
    // Even if only the production audit reports it.
    const prodOnly = judgeAudit({ full: CLEAN, prod: report(advisory('next', 'GHSA-9999-8888-7777')), exceptions: EX, nowMs: NOW });
    assert.equal(prodOnly.blocking.length, 1);
});

test('an exception holds through its review date and blocks the day after', () => {
    const at = (iso) => judgeAudit({ full: report(BRACES), prod: CLEAN, exceptions: EX, nowMs: Date.parse(iso) });
    assert.equal(at('2026-11-02T23:59:59Z').blocking.length, 0);
    assert.match(at('2026-11-03T00:00:00Z').blocking[0].why, /expired on 2026-11-02/);
    const bad = judgeAudit({ full: report(BRACES), prod: CLEAN, exceptions: [{ ...EX[0], reviewBy: 'soon' }], nowMs: NOW });
    assert.equal(bad.blocking.length, 1, 'a malformed review date is not an open-ended exception');
});

test('an exception whose advisory is gone is reported as stale, not a failure', () => {
    const v = judgeAudit({ full: CLEAN, prod: CLEAN, exceptions: EX, nowMs: NOW });
    assert.deepEqual([v.blocking.length, v.stale.length], [0, 1]);
});

test('main: 0 only when it audited and nothing blocks; 2 when it could not audit', () => {
    const run = (audit, nowMs = NOW) => { const lines = []; return { code: main({ audit, nowMs, out: (l) => lines.push(l) }), text: lines.join('\n') }; };
    const pass = run((extra) => (extra.includes('--omit=dev') ? CLEAN : report(BRACES)));
    assert.equal(pass.code, 0);
    assert.match(pass.text, /^OK:/m);
    assert.match(pass.text, /excepted: GHSA-VFJ7-8CJW-P6XM braces/);
    const block = run(() => report(BRACES, advisory('left-pad', 'GHSA-1111-2222-3333')));
    assert.equal(block.code, 1);
    assert.match(block.text, /::error::GHSA-1111-2222-3333 left-pad/);
    assert.equal(run(() => { throw new Error('registry down'); }).code, 2);
    const soon = run((extra) => (extra.includes('--omit=dev') ? CLEAN : report(BRACES)), Date.parse('2026-10-30T00:00:00Z'));
    assert.match(soon.text, /::warning::.*expires in 4 day/);
});

test('every listed exception names an advisory, a package, a reason and a valid review date', () => {
    for (const e of EXCEPTIONS) {
        assert.match(e.id, /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
        assert.ok(e.package && e.reason.length > 10);
        assert.match(e.reviewBy, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(Number.isFinite(Date.parse(`${e.reviewBy}T00:00:00Z`)));
    }
});

test('CI runs the gate script, not a bare npm audit', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    assert.match(ci, /run: node scripts\/check-audit\.mjs/);
    assert.ok(!/run: npm audit\b/.test(ci), 'a bare npm audit cannot hold a reviewed exception');
});
