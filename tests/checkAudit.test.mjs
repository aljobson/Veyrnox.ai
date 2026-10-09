import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALLOWED, assessAudit } from '../scripts/check-audit.mjs';

const WAIVED = { id: 'GHSA-aaaa-bbbb-cccc', reason: 'no fixed version; build tooling only' };
const advisory = (name, id, severity = 'high') => ({
    source: 1, name, dependency: name, title: `${name} advisory`, severity,
    url: `https://github.com/advisories/${id}`, range: '*',
});
// `npm audit --json` (report version 2): the package that owns an advisory
// carries it as an object in `via`; its dependents carry the package's name.
const report = (vulnerabilities) => ({ auditReportVersion: 2, vulnerabilities });
const BREAKING_FIX = { name: 'tailwindcss', version: '4.3.3', isSemVerMajor: true };
const waivedTree = (extra = {}) => report({
    braces: { name: 'braces', severity: 'high', via: [advisory('braces', WAIVED.id)], fixAvailable: BREAKING_FIX },
    micromatch: { name: 'micromatch', severity: 'high', via: ['braces'], fixAvailable: BREAKING_FIX },
    ...extra,
});

test('an allowed advisory and the packages that inherit it pass', () => {
    const { problems, waived } = assessAudit(waivedTree(), [WAIVED]);
    assert.deepEqual(problems, []);
    assert.deepEqual(waived, [{ id: WAIVED.id, package: 'braces', severity: 'high' }]);
});

test('any other high or critical advisory fails, named', () => {
    for (const severity of ['high', 'critical']) {
        const { problems } = assessAudit(waivedTree({
            undici: { name: 'undici', severity, via: [advisory('undici', 'GHSA-zzzz-zzzz-zzzz', severity)], fixAvailable: true },
        }), [WAIVED]);
        assert.equal(problems.length, 1, severity);
        assert.match(problems[0], /undici/);
        assert.match(problems[0], /GHSA-zzzz-zzzz-zzzz/);
    }
});

test('a second advisory on an allowed package is not covered by the first', () => {
    const { problems } = assessAudit(report({
        braces: { name: 'braces', severity: 'high', via: [advisory('braces', WAIVED.id), advisory('braces', 'GHSA-new1-new1-new1')], fixAvailable: BREAKING_FIX },
    }), [WAIVED]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /GHSA-new1-new1-new1/);
});

test('moderate and low advisories do not fail the gate', () => {
    const { problems } = assessAudit(waivedTree({
        postcss: { name: 'postcss', severity: 'moderate', via: [advisory('postcss', 'GHSA-mmmm-mmmm-mmmm', 'moderate')], fixAvailable: true },
    }), [WAIVED]);
    assert.deepEqual(problems, []);
});

test('an advisory with no readable id is never treated as allowed', () => {
    const { problems } = assessAudit(report({
        odd: { name: 'odd', severity: 'high', via: [{ name: 'odd', severity: 'high', title: 'no url' }], fixAvailable: false },
    }), []);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /odd/);
});

test('an allowed advisory fails once a fix needs no breaking upgrade', () => {
    const { problems } = assessAudit(report({
        braces: { name: 'braces', severity: 'high', via: [advisory('braces', WAIVED.id)], fixAvailable: true },
    }), [WAIVED]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /npm audit fix/);
    assert.match(problems[0], new RegExp(WAIVED.id));
});

test('an allowed advisory fails once a production dependency installs the package', () => {
    // `npm audit --omit=dev` is clean while only build and lint tooling pulls it in.
    assert.deepEqual(assessAudit(waivedTree(), [WAIVED], report({})).problems, []);
    const { problems, waived } = assessAudit(waivedTree(), [WAIVED], waivedTree());
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`${WAIVED.id} \\(braces\\) is now installed by a production dependency`));
    assert.deepEqual(waived, []);
});

test('a production report that cannot be read is refused, not read as clean', () => {
    for (const bad of [null, {}, { error: { code: 'ENOTFOUND' } }]) {
        assert.throws(() => assessAudit(waivedTree(), [WAIVED], bad), /audit report/, JSON.stringify(bad));
    }
});

test('the gate itself checks the production tree', () => {
    const script = readFileSync(new URL('../scripts/check-audit.mjs', import.meta.url), 'utf8');
    assert.match(script, /assessAudit\(readReport\(\), ALLOWED, readReport\(\['--omit=dev'\]\)\)/);
});

test('an allowed advisory that is no longer reported fails until its entry is removed', () => {
    const { problems } = assessAudit(report({}), [WAIVED]);
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`${WAIVED.id}.*remove`, 'i'));
});

test('a report that is not an audit report is refused, not read as clean', () => {
    for (const bad of [null, {}, { error: { code: 'ENOTFOUND' } }, { auditReportVersion: 1, advisories: {} }]) {
        assert.throws(() => assessAudit(bad, []), /audit report/, JSON.stringify(bad));
    }
});

test('every allowed entry names one advisory and says why', () => {
    for (const entry of ALLOWED) {
        assert.match(entry.id, /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/);
        assert.ok(entry.reason.length > 40, `${entry.id} needs a reason`);
    }
    assert.equal(new Set(ALLOWED.map((e) => e.id)).size, ALLOWED.length);
});

test('CI runs the gate through the script, with no bare npm audit left', () => {
    const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
    assert.match(ci, /run: node scripts\/check-audit\.mjs/);
    assert.doesNotMatch(ci, /npm audit --audit-level/);
});
