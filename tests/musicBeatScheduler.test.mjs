import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { createScheduler } from '../app/veyrnox/_lib/music/beat/beatScheduler.mjs';
import { stepTime, loopSeconds, stepSeconds } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
import { setTempo, setSwing, setSteps, selectPattern, addHitAtStep } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
function fixture() {
  let now = 0, hidden = false, callback;
  let doc = createBeat({ id: 'e40439d1-646a-4c11-9c12-69fa3a851234', now: 0 });
  doc.swing = 0.5;
  const steps = [], events = [];
  const scheduler = createScheduler({
    clock: () => now, isHidden: () => hidden,
    setTimer: (fn, delay) => { assert.equal(delay, 25); callback = fn; return fn; }, clearTimer: () => {},
    onStep: (step, time) => { assert.ok(time >= now, `${time} is before ${now}`); steps.push({ step, time }); },
    onEvent: (event, time) => { assert.ok(time >= now); events.push({ ...event, time }); },
  });
  scheduler.update(() => doc);
  return { scheduler, steps, events, get now() { return now; }, advance(seconds) { now += seconds; callback?.(); }, set hidden(value) { hidden = value; }, get callback() { return callback; }, get doc() { return doc; }, set doc(value) { doc = value; } };
}
function orderedAnalytic(f, start) {
  f.steps.forEach(({ step, time }, index) => {
    assert.equal(step, index % f.doc.steps);
    const analytic = start + Math.floor(index / f.doc.steps) * loopSeconds(f.doc.tempo.bpm, f.doc.steps) + stepTime(step, f.doc.tempo.bpm, f.doc.swing);
    assert.ok(Math.abs(time - analytic) < 1e-9, `${time} != ${analytic}`);
  });
}
test('five minutes at 92 BPM: jitter and hidden stalls emit every step exactly once at analytic times', () => {
  const f = fixture(); const start = 0.03; let seed = 123;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  f.scheduler.start(start);
  while (f.now < 300) {
    f.hidden = Math.floor(f.now / 10) % 2 === 1;
    f.scheduler.refill();
    f.advance(0.025 + random() * 0.04 + (Math.floor(f.now / 10) % 2 === 1 && random() < 0.2 ? 1.2 : 0));
  }
  assert.equal(f.scheduler.skipped, 0);
  assert.ok(f.steps.length > 1800);
  orderedAnalytic(f, start);
  const eventKeys = f.events.map((e) => `${e.pad}:${e.time}`);
  assert.equal(new Set(eventKeys).size, eventKeys.length);
});
test('tempo and swing edits affect the next unscheduled step; queued events retain their times', () => {
  const f = fixture(); f.scheduler.start(0.03);
  const first = structuredClone(f.steps);
  f.doc = setSwing(setTempo(f.doc, 120), 0.6);
  f.advance(0.1);
  const second = f.steps[1];
  assert.deepEqual(f.steps.slice(0, first.length), first);
  assert.equal(second.step, 1);
  assert.ok(Math.abs(second.time - (0.03 + stepSeconds(120) + 0.6 * stepSeconds(120) * 0.5)) < 1e-9);
  f.advance(0.1);
  assert.ok(Math.abs(f.steps[2].time - (0.03 + 2 * stepSeconds(120))) < 1e-9);
});
test('pattern, hits and length are read at schedule time', () => {
  const f = fixture(); f.scheduler.start(0.03);
  f.doc = addHitAtStep(selectPattern(setSteps(f.doc, 32), 'B'), 'tom', 1);
  f.advance(0.1);
  assert.ok(f.events.some((e) => e.pad === 'tom' && e.step === 1));
  assert.ok(!f.events.some((e) => e.pad === 'hat' && e.step === 2));
});
test('visible tick then hidden refill survives a 1.2 second stall without dropped steps', () => {
  const f = fixture(); f.scheduler.start(0.03); f.advance(0.025);
  f.hidden = true; f.scheduler.refill(); f.advance(1.2);
  assert.equal(f.scheduler.skipped, 0); orderedAnalytic(f, 0.03);
});
test('a visible 0.1 second stall skips nothing; a 0.5 second stall skips without bursting', () => {
  const f = fixture(); f.scheduler.start(0.03); f.advance(0.1);
  assert.equal(f.scheduler.skipped, 0);
  const before = f.steps.length; f.advance(0.5);
  assert.ok(f.scheduler.skipped > 0);
  assert.ok(f.steps.slice(before).every((s) => s.time >= f.now));
  assert.ok(f.steps.length - before <= 2);
});
test('a stall beyond the hidden horizon skips forward and never bursts overdue events', () => {
  const f = fixture(); f.hidden = true; f.scheduler.start(0.03);
  const before = f.steps.length; f.advance(4);
  assert.ok(f.scheduler.skipped > 0);
  assert.ok(f.steps.slice(before).every((s) => s.time >= 4));
});
test('stop invalidates queued callbacks; immediate restart is a fresh run', () => {
  const f = fixture(); f.scheduler.start(0.03); const stale = f.callback;
  f.scheduler.stop(); const before = [f.steps.length, f.events.length];
  f.advance(0.2); stale(); f.scheduler.refill();
  assert.deepEqual([f.steps.length, f.events.length], before);
  f.scheduler.start(f.now + 0.03); const restarted = f.steps.length;
  stale(); assert.equal(f.steps.length, restarted);
  assert.equal(f.steps[before[0]].step, 0);
  assert.ok(f.steps[before[0]].time >= f.now);
});
test('recording quantizes to the closest audio step, including a slow future step beyond lookahead', () => {
  const f = fixture(); f.doc.tempo.bpm = 40; f.doc.swing = 0;
  f.scheduler.start(0.03);
  assert.equal(f.scheduler.nearestStepAt(0.25).step, 1);
  assert.equal(f.scheduler.nearestStepAt(0.25).time, 0.405);
  assert.equal(f.scheduler.nearestStepAt(0.1).step, 0);
  f.scheduler.stop(); assert.equal(f.scheduler.nearestStepAt(1), null);
});
