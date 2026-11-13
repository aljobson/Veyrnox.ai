import test from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../scripts/audit-template-fidelity.mjs';
import { BROKEN_TEMPLATE_IDS } from '../app/veyrnox/_lib/brokenTemplateIds.js';
import { selectProbeSet, projectedCredits, generationBody, quoteCredits, syntheticPng, fileRow, fitToBudget, paid, photoCount, DEFAULT_MAX_CREDITS } from '../scripts/probe-video-templates-staging.mjs';

const unit = { 'kling-3.0-i2v': 32, 'seedance-2.0-fast': 19, 'seedance-2.0-reference': 85 };
const picks = selectProbeSet(audit().contracts);

test('the probe covers nine distinct, published templates across the three models', () => {
  assert.equal(picks.length, 9);
  assert.equal(new Set(picks.map(p => p.contract.id)).size, 9);
  assert.ok(picks.every(p => !BROKEN_TEMPLATE_IDS.includes(p.contract.id)));
  for (const model of ['kling-3.0-i2v', 'seedance-2.0-fast', 'seedance-2.0-reference']) assert.ok(picks.some(p => p.contract.modelId === model), model);
  assert.equal(picks.filter(p => p.contract.class === 'blocked-needs-video').length, 4);
});

test('quotes follow the 5-second unit and the paid total stays under the default cap', () => {
  assert.equal(quoteCredits(32, 10), 64);
  assert.equal(quoteCredits(85, 5), 85);
  const paidPicks = picks.filter(paid);
  assert.equal(projectedCredits(picks, unit), paidPicks.reduce((sum, p) => sum + quoteCredits(unit[p.contract.modelId], p.contract.duration), 0));
  assert.ok(paidPicks.length >= 3);
  assert.ok(projectedCredits(picks, unit) <= DEFAULT_MAX_CREDITS);
});

test('blocked templates are never paid, and every request carries the quote and consent only with photos', () => {
  for (const pick of picks) {
    const keys = Array.from({ length: photoCount(pick.contract) }, (_, i) => `uploads/k${i}.png`);
    const body = generationBody(pick, keys, unit, 'tpl-probe-test-0001');
    assert.equal(body.template_id, pick.contract.id);
    assert.equal(body.confirmed_credits, quoteCredits(unit[pick.contract.modelId], pick.contract.duration));
    assert.equal(Boolean(body.consent), keys.length > 0);
    assert.equal(body.references?.length ?? 0, keys.length);
    if (pick.contract.class === 'bound') assert.equal(keys.length, pick.contract.slotCount);
    if (!paid(pick)) assert.equal(pick.contract.class, 'blocked-needs-video');
  }
});

test('the synthetic photo is a valid 512 px PNG', () => {
  const png = syntheticPng();
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
});

test('files carry only known words: network text, amounts and job ids never reach them', () => {
  const row = { label: 'x', id: 't', modelId: 'm', class: 'bound', quoted: 85, submit: '400:<script>alert(1)</script>', jobId: 'secret-job', state: 'weird', charged: 85, refunded: true, note: 'error: boom\n' };
  const out = fileRow(row);
  assert.deepEqual([out.submit, out.state, out.charged, out.refunded, out.note], ['400:other', 'other', 'matches quote', 'yes', 'error']);
  assert.equal(out.jobId, undefined);
  assert.equal(fileRow({ ...row, submit: '400:template_blocked', charged: 0, note: 'refused before charge (as designed)' }).charged, 'none');
  assert.equal(fileRow({ label: 'x', id: 't', modelId: 'm', class: 'c', quoted: 0 }).submit, '(dry run)');
});

test('fitToBudget drops the dearest paid probes first and always keeps the free blocked ones', () => {
  const fit = fitToBudget(picks, unit, 47);
  assert.ok(projectedCredits(fit, unit) <= 47);
  assert.equal(fit.filter(p => !paid(p)).length, 4);
  assert.ok(fit.filter(paid).every(p => p.contract.modelId === 'seedance-2.0-fast'));
  assert.equal(fitToBudget(picks, unit, 280).length, 9);
});
