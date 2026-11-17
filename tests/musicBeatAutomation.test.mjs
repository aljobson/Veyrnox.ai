import test from 'node:test';
import assert from 'node:assert/strict';
import { automationEnvelope, envelopeAt, curveShape, scheduleAutomation } from '../app/veyrnox/_lib/music/beat/beatAutomation.mjs';
import { seededRandom } from '../app/veyrnox/_lib/music/beat/beatSeed.mjs';
import { Param as BaseParam } from './musicBeatMixFixtures.mjs';
class Param extends BaseParam { cancelScheduledValues() { throw new Error('Windows must never cancel'); } }
const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-6, `${a} != ${b}`);
const lane = [[960, 0.2, 0], [3840, 0.95, -0.6], [9000, 0.1, 0.6], [14400, 0.85, 0], [20040, 0.3, 0]];
test('curves have exact endpoints, monotonicity and 16 interior chords only for curved segments', () => {
  for (let c = -1; c <= 1; c += 0.1) {
    assert.equal(curveShape(0, c), 0); assert.equal(curveShape(1, c), 1);
    for (let i = 1; i <= 100; i++) assert.ok(curveShape(i / 100, c) >= curveShape((i - 1) / 100, c));
  }
  const env = automationEnvelope(lane, 120);
  assert.equal(env.length, lane.length + 32);
  for (const [tick, value] of lane) close(envelopeAt(env, tick / 1920), value);
  assert.equal(envelopeAt(env, -10), 0.2); assert.equal(envelopeAt(env, 100), 0.3);
});
test('A1: random live windows, curved chord boundaries and vertex-free windows equal offline and canonical values at 1000 times', () => {
  const random = seededRandom(82), env = automationEnvelope(lane, 123), offline = new Param(), live = new Param();
  scheduleAutomation(offline, env, { fromSec: 0.27, toSec: 13.03, contextTime: 4 });
  let fromSec = 0.27, windows = 0;
  while (fromSec < 13.03) {
    const toSec = Math.min(13.03, fromSec + 0.007 + random() * 0.31);
    scheduleAutomation(live, env, { fromSec, toSec, contextTime: 4 + fromSec - 0.27 });
    fromSec = toSec; windows++;
  }
  assert.ok(windows > 60);
  for (let i = 0; i < 1000; i++) {
    const sec = 0.27 + random() * 12.76, at = 4 + sec - 0.27;
    close(live.at(at), offline.at(at)); close(live.at(at), envelopeAt(env, sec));
  }
});
test('A1: cycle seams jump to the canonical range start on every pass, then equal an offline pass', () => {
  const env = automationEnvelope(lane, 123), live = new Param(), offline = new Param();
  const start = 1.183, end = 4.918, length = end - start;
  scheduleAutomation(offline, env, { fromSec: start, toSec: end, contextTime: 0 });
  for (let pass = 0; pass < 5; pass++) for (let a = start; a < end;) {
    const b = Math.min(end, a + 0.117);
    scheduleAutomation(live, env, { fromSec: a, toSec: b, contextTime: pass * length + a - start }); a = b;
  }
  for (let pass = 0; pass < 5; pass++) for (let i = 0; i < 1000; i++) {
    const offset = i / 1000 * length;
    close(live.at(pass * length + offset), offline.at(offset)); close(live.at(pass * length + offset), envelopeAt(env, start + offset));
  }
});
