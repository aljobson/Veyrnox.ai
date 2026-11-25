import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const csvPath = new URL('../replica/byecut/features.csv', import.meta.url);
const coveragePath = new URL('../replica/byecut/coverage.json', import.meta.url);
const coverageHashPath = new URL('../replica/byecut/coverage.sha256', import.meta.url);
const csv = fs.readFileSync(csvPath);
const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const rows = csv.toString('utf8').trim().split('\n').slice(1);

test('ByeCut coverage sidecar is bound to the frozen clean-room matrix', () => {
  assert.equal(crypto.createHash('sha256').update(csv).digest('hex'), coverage.matrix.sha256);
  assert.equal(rows.length, 87);
  assert.equal(rows.filter((row) => row.includes(',skip,yes,skip,')).length, 9);
  assert.equal(Object.keys(coverage.entries).length, rows.length);
  const declaredCoverageHash = fs.readFileSync(coverageHashPath, 'utf8').trim().split(/\s+/)[0];
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(coveragePath)).digest('hex'), declaredCoverageHash);
});

test('every ByeCut row has an owner, target platforms, provenance and evidence', () => {
  const validStatuses = new Set(['yes', 'partial', 'missing', 'not-device-verified', 'pending-owner-authorization', 'skip']);
  const validPlatforms = new Set(['web', 'ios', 'android']);
  const validProvenance = new Set(['device', 'public-site', 'inference']);
  rows.forEach((row, index) => {
    const entry = coverage.entries[`F${String(index + 1).padStart(3, '0')}`];
    assert.ok(entry, `row ${index + 1} has a sidecar entry`);
    assert.equal(entry.feature, row.split(',')[0]);
    assert.ok(validStatuses.has(entry.status), `${entry.feature} has a valid status`);
    assert.ok(entry.owningWorkstream, `${entry.feature} has an owning workstream`);
    assert.ok(entry.platforms.length, `${entry.feature} names target platforms`);
    assert.ok(entry.provenance.length, `${entry.feature} names provenance`);
    assert.ok(entry.platforms.every((value) => validPlatforms.has(value)), `${entry.feature} uses known platforms`);
    assert.ok(entry.provenance.every((value) => validProvenance.has(value)), `${entry.feature} uses known provenance`);
    assert.equal(new Set(entry.platforms).size, entry.platforms.length, `${entry.feature} has no duplicate platforms`);
    assert.equal(new Set(entry.provenance).size, entry.provenance.length, `${entry.feature} has no duplicate provenance`);
    assert.ok(entry.evidence.length, `${entry.feature} names evidence`);
    assert.ok(entry.evidenceRationale, `${entry.feature} explains why its evidence is relevant`);
    entry.evidence.forEach((evidencePath) => assert.ok(
      fs.existsSync(new URL(`../${evidencePath}`, import.meta.url)),
      `${entry.feature} evidence exists: ${evidencePath}`,
    ));
    if (!['missing', 'skip'].includes(entry.status)) {
      assert.ok(entry.evidence.some((evidencePath) => !evidencePath.startsWith('replica/byecut/')), `${entry.feature} names Veyrnox source or test evidence`);
    }
    if (entry.status === 'missing') assert.match(entry.auditNote, /Repository audit on 2026-11-23 found no Veyrnox source/, `${entry.feature} records the search that found no implementation`);
    if (entry.status === 'yes') assert.ok(entry.journeyEvidence?.length, `${entry.feature} has web/device journey evidence before it is yes`);
  });
});

test('all in-scope features are source-complete without making a premature journey claim', () => {
  const inScope = Object.values(coverage.entries).filter((entry) => entry.status !== 'skip');
  assert.equal(inScope.length, 78);
  assert.equal(inScope.filter((entry) => entry.status === 'not-device-verified').length, 78);
  assert.equal(inScope.filter((entry) => entry.status === 'partial' || entry.status === 'missing').length, 0);
  assert.equal(inScope.filter((entry) => entry.status === 'yes').length, 0);
  for (const id of ['F001', 'F002', 'F003', 'F012', 'F014', 'F015', 'F019', 'F025', 'F027', 'F042', 'F043', 'F049', 'F057', 'F059', 'F066', 'F071', 'F074', 'F077']) {
    assert.equal(coverage.entries[id].status, 'not-device-verified');
  }
  assert.equal(coverage.entries.F025.owningWorkstream, '2');
  assert.equal(coverage.entries.F042.owningWorkstream, '2');
  assert.equal(coverage.entries.F043.owningWorkstream, '2');
  assert.deepEqual(coverage.entries.F001.provenance, ['public-site']);
  assert.deepEqual(coverage.entries.F063.provenance, ['public-site']);
});
