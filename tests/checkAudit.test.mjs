import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_EXCEPTION_DAYS, assessAudit, severeAdvisories } from '../scripts/check-audit.mjs';

const BRACES = 'GHSA-vfj7-8cjw-p6xm';
const advisory = (id, name, severity = 'high') => ({ source: 1, name, title: `${name} problem`, url: `https://github.com/advisories/${id}`, severity, range: '*' });
const report = (vulnerabilities = {}) => ({ auditReportVersion: 2, vulnerabilities, metadata: {} });
// braces is the advisory; micromatch only inherits it, as in a real report.
const bracesReport = () => report({
    braces: { name: 'braces', severity: 'high', via: [advisory(BRACES, 'braces')] },
    micromatch: { name: 'micromatch', severity: 'high', via: ['braces'] },
});
const exception = (over = {}) => ({ id: BRACES, package: 'braces', reason: 'No fixed version exists; build-time only.', expires: '2026-11-02', ...over });
const today = '2026-10-03';
const assess = (over = {}) => assessAudit({ full: bracesReport(), prod: report(), exceptions: [exception()], today, ...over });

test('reads each high or critical advisory once and ignores lower severities', () => {
    const found = severeAdvisories(report({
        braces: { via: [advisory(BRACES, 'braces')] },
        micromatch: { via: ['braces'] },
        chokidar: { via: ['braces', advisory(BRACES, 'braces')] },
        minor: { via: [advisory('GHSA-aaaa-bbbb-cccc', 'minor', 'moderate')] },
        worst: { via: [advisory('GHSA-dddd-eeee-ffff', 'worst', 'critical')] },
    }));
    assert.deepEqual(found.map((a) => [a.id, a.package, a.severity]), [[BRACES, 'braces', 'high'], ['GHSA-dddd-eeee-ffff', 'worst', 'critical']]);
});

test('anything that is not a version 2 audit report is refused, not read as clean', () => {
    for (const bad of [null, {}, { error: { summary: 'ENOTFOUND' } }, { auditReportVersion: 1, vulnerabilities: {} }, { auditReportVersion: 2 }]) {
        assert.throws(() => severeAdvisories(bad), /not an npm audit report/);
    }
});

test('a clean audit passes and reports an exception that is no longer needed', () => {
    const out = assess({ full: report() });
    assert.deepEqual(out.failures, []);
    assert.deepEqual(out.unused, [`${BRACES} (braces)`]);
});

test('an excepted dev-only advisory passes while its exception is in date', () => {
    const out = assess();
    assert.deepEqual(out.failures, []);
    assert.equal(out.excepted.length, 1);
    assert.match(out.excepted[0], /excepted until 2026-11-02/);
    assert.deepEqual(out.warnings, []);
});

test('the same advisory fails with no exception, a wrong package, or after expiry', () => {
    assert.match(assess({ exceptions: [] }).failures.join(), /no fix applied and no exception/);
    assert.match(assess({ exceptions: [exception({ package: 'micromatch' })] }).failures.join(), /no fix applied and no exception/);
    assert.deepEqual(assess({ today: '2026-11-02' }).failures, [], 'valid through its expiry day');
    assert.match(assess({ today: '2026-11-03' }).failures.join(), /its exception expired on 2026-11-02/);
});

test('an exception never covers an advisory that reaches a production dependency', () => {
    const out = assess({ prod: bracesReport() });
    assert.equal(out.failures.length, 1);
    assert.match(out.failures[0], /reaches a production dependency; no exception applies/);
    assert.deepEqual(out.excepted, []);
});

test('an unexcepted advisory still fails alongside an excepted one', () => {
    const full = bracesReport();
    full.vulnerabilities.other = { via: [advisory('GHSA-1111-2222-3333', 'other', 'critical')] };
    const out = assess({ full });
    assert.equal(out.excepted.length, 1);
    assert.equal(out.failures.length, 1);
    assert.match(out.failures[0], /GHSA-1111-2222-3333 other \(critical\)/);
});

test('an advisory with no GHSA link cannot be excepted', () => {
    const full = report({ odd: { via: [{ source: 77, name: 'odd', severity: 'high', url: '' }] } });
    const out = assess({ full, exceptions: [exception({ package: 'odd' })] });
    assert.match(out.failures.join(), /npm:77 odd \(high\) — no fix applied and no exception/);
});

test('malformed or open-ended exceptions fail the gate', () => {
    const bad = [
        [{ ...exception(), id: 'CVE-2026-1' }, /has no GHSA id/],
        [{ ...exception(), package: '' }, /names no package/],
        [{ ...exception(), reason: 'because' }, /has no written reason/],
        [{ ...exception(), expires: 'never' }, /has no expiry date/],
        [{ ...exception(), expires: '2026-02-31' }, /has no expiry date/],
        [{ ...exception(), expires: '2027-06-01' }, new RegExp(`more than ${MAX_EXCEPTION_DAYS} days out`)],
        ['GHSA-vfj7-8cjw-p6xm', /is not an object/],
    ];
    for (const [entry, expected] of bad) {
        const out = assess({ exceptions: [entry] });
        assert.match(out.failures.join(' | '), expected);
        // The invalid entry excepts nothing, so the advisory fails too.
        assert.match(out.failures.join(' | '), /no fix applied and no exception/);
    }
    assert.match(assess({ exceptions: { id: BRACES } }).failures.join(), /must hold an array/);
});

test('an exception close to expiry warns before it fails', () => {
    assert.deepEqual(assess({ today: '2026-10-25' }).warnings, []);
    assert.match(assess({ today: '2026-10-26' }).warnings.join(), /expires on 2026-11-02/);
});

test('CI runs this gate, and the committed exceptions are well formed', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    assert.match(ci, /- name: Audit \(high and above\)\n\s+run: node scripts\/check-audit\.mjs\n/);
    assert.doesNotMatch(ci, /npm audit --audit-level/);
    const committed = JSON.parse(readFileSync(new URL('../scripts/audit-exceptions.json', import.meta.url), 'utf8'));
    assert.ok(Array.isArray(committed));
    for (const e of committed) {
        assert.match(e.id, /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
        assert.ok(e.package && e.reason.length >= 20 && /^\d{4}-\d{2}-\d{2}$/.test(e.expires), e.id);
    }
});
