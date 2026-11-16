import test from 'node:test';
import assert from 'node:assert/strict';
import { make } from './musicBeatFixtures.mjs';
import { FakeContext } from './musicBeatMixFixtures.mjs';
import { createBeatEngine } from '../app/veyrnox/_lib/music/beat/beatEngine.js';
import { addEffect, setSend, setMaster, addAutomationPoint } from '../app/veyrnox/_lib/music/beat/beatMixOps.mjs';
import { addTrack } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
class LiveContext extends FakeContext { async close() {} }
function engineFor(t) {
  const previous = globalThis.window; globalThis.window = { AudioContext: LiveContext };
  t.after(() => { globalThis.window = previous; });
  const engine = createBeatEngine(); t.after(() => engine.close()); return engine;
}
test('no-master runs and auditions share the original output compressor, including send returns', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = engineFor(t), plain = engine.startRun(make());
  const mixed = engine.startRun(setSend(addEffect(make(), 't1', 'eq'), 't1', 'reverb', 0.2));
  assert.equal(plain.master, null); assert.equal(mixed.master, null);
  assert.deepEqual(plain.bus.connections, [engine.master]); assert.deepEqual(mixed.bus.connections, [engine.master]);
  assert.equal(engine.context.nodes.filter(n => n.type === 'compressor').length, 1);
  assert.equal(plain.channels.get('t1').panner.connections[0], plain.bus);
  assert.equal(engine.live.bus, engine.master);
  const send = mixed.mix.sends.reverb;
  assert.ok(send); assert.ok(mixed.mix.nodes.some(n => n.connections.includes(mixed.bus)));
  engine.stopRun(mixed); t.mock.timers.tick(60);
  assert.equal(send.disconnected, true); assert.equal(engine.master.disconnected, undefined);
  assert.equal(engine.master.outputNode.disconnected, undefined); assert.equal(plain.bus.disconnected, undefined);
});
test('explicit master runs keep their own output section and do not pass through the shared compressor', t => {
  const engine = engineFor(t), run = engine.startRun(setMaster(make(), { gain: 0.6 }));
  assert.ok(run.master); assert.deepEqual(run.bus.connections, [engine.context.destination]);
  assert.ok(run.master.output.connections.includes(run.bus));
  assert.equal(engine.context.nodes.filter(n => n.type === 'compressor').length, 2);
});
for (const explicitMaster of [false, true]) test(`missing strips are built lazily with effects, sends and automation (master=${explicitMaster})`, t => {
  const engine = engineFor(t), doc = explicitMaster ? setMaster(make(), { gain: 0.6 }) : make();
  const run = engine.startRun(doc, { automationActive: true });
  let next = addTrack(doc, '808'); next = addEffect(next, 't2', 'eq'); next = setSend(next, 't2', 'delay', 0.2);
  next = addAutomationPoint(next, 't2', 'gain', 0, 0.75); next = addAutomationPoint(next, 't2', 'pan', 0, -0.5);
  next.tracks[1].gain = 0;
  const input = engine.setTrackMix(run, 't2', 0, 0, next), strip = run.channels.get('t2');
  assert.equal(input, strip.input); assert.equal(strip.chain.length, 1); assert.notEqual(strip.input, strip.fader);
  assert.equal(strip.sends.delay.connections[0], run.mix.sends.delay);
  strip.schedule({ fromSec: 0, toSec: 1, contextTime: 1 });
  assert.equal(strip.fader.gain.at(1.5), 0.75); assert.equal(strip.panner.pan.at(1.5), -0.5);
  next.tracks[1].mute = true; engine.setTrackMix(run, 't2', 0, 0, next);
  assert.equal(strip.input.gain.events.at(-1).value, 0);
  assert.equal(strip.fader.gain.events.some(e => e.type === 'target'), false);
  const count = engine.context.nodes.length; engine.setTrackMix(run, 't2', 0, 0, next);
  assert.equal(engine.context.nodes.length, count); assert.equal(run.channels.get('t2'), strip);
});
