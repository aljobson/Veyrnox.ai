import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDaily, IGNORED } from '../scripts/daily-audit.mjs';

const adv = (id, severity, title = 't') => ({ source: 1, name: 'x', title, url: `https://github.com/advisories/${id}`, severity });
const report = (vulnerabilities) => ({ auditReportVersion: 2, vulnerabilities });
const ID = 'GHSA-aaaa-bbbb-cccc';

test('a clean report passes', () => {
  assert.deepEqual(assessDaily(report({})), { problems: [], ignored: [] });
});

test('moderate, high and critical fail; low does not', () => {
  for (const severity of ['moderate', 'high', 'critical']) {
    const r = assessDaily(report({ pkg: { via: [adv(ID, severity)], fixAvailable: true } }));
    assert.equal(r.problems.length, 1, severity);
  }
  assert.equal(assessDaily(report({ pkg: { via: [adv(ID, 'low')], fixAvailable: false } })).problems.length, 0);
});

test('an inherited advisory (via holds only a name) is not counted twice', () => {
  const r = assessDaily(report({ owner: { via: [adv(ID, 'moderate')], fixAvailable: true }, child: { via: ['owner'], fixAvailable: true } }));
  assert.equal(r.problems.length, 1);
});

test('an ignored advisory with no fix is waived, with the package named', () => {
  const r = assessDaily(report({ pkg: { via: [adv(ID, 'moderate')], fixAvailable: { name: 'a', version: '1', isSemVerMajor: true } } }), [{ id: ID, reason: 'r' }]);
  assert.deepEqual(r.problems, []);
  assert.match(r.ignored[0], /pkg/);
});

test('an ignored advisory that can now be fixed, or is gone, is a problem', () => {
  const fixable = assessDaily(report({ pkg: { via: [adv(ID, 'moderate')], fixAvailable: true } }), [{ id: ID, reason: 'r' }]);
  assert.match(fixable.problems[0], /can now be fixed/);
  const gone = assessDaily(report({}), [{ id: ID, reason: 'r' }]);
  assert.match(gone.problems[0], /remove it from IGNORED/);
});

test('a report that is not npm audit v2 throws', () => {
  assert.throws(() => assessDaily({ auditReportVersion: 1 }), /not an npm audit report/);
});

test('every ignored entry carries an id and a reason', () => {
  for (const list of Object.values(IGNORED)) for (const e of list) assert.match(e.id, /^GHSA(-[0-9a-z]{4}){3}$/i), assert.ok(e.reason.length > 20);
});
