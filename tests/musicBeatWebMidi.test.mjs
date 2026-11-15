import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMidiMessage, bindMidiAccess, inputContextTime } from '../app/veyrnox/_lib/music/beat/beatWebMidi.mjs';
test('MIDI parser handles all channels, both note offs, and ignores other or malformed messages', () => {
  for (let channel = 0; channel < 16; channel++) {
    assert.deepEqual(parseMidiMessage([0x90 + channel, 60, 100]), { type: 'on', pitch: 60, velocity: 100, channel });
    assert.equal(parseMidiMessage([0x90 + channel, 60, 0]).type, 'off'); assert.equal(parseMidiMessage([0x80 + channel, 60, 100]).type, 'off');
  }
  for (const message of [[], [0x90, 60], [0x90, 128, 100], [0x90, 60, -1], [0xb0, 64, 127], [0xe0, 0, 64], [0x90, 60.5, 100], null]) assert.equal(parseMidiMessage(message), null);
});
test('mocked MIDIAccess binds one input, hotplugs, switches and cleans up idempotently', () => {
  const device = (id) => Object.assign(new EventTarget(), { id, name: id, state: 'connected' });
  const a = device('a'), b = device('b'), access = Object.assign(new EventTarget(), { inputs: new Map([['a', a], ['b', b]]) });
  const events = [], lists = [], binding = bindMidiAccess(access, (n) => events.push(n), (devices, id) => lists.push([devices.length, id]));
  const send = (input) => input.dispatchEvent(Object.assign(new Event('midimessage'), { data: [0x91, 60, 100] }));
  send(a); send(b); assert.equal(events.length, 1);
  binding.select('b'); send(a); send(b); assert.equal(events.length, 2);
  b.state = 'disconnected'; access.dispatchEvent(new Event('statechange')); send(a); assert.equal(events.length, 3);
  binding.dispose(); binding.dispose(); send(a); access.dispatchEvent(new Event('statechange')); assert.equal(events.length, 3); assert.deepEqual(lists.at(-1), [1, 'a']);
});
test('MIDI event timestamps convert through performance and subtract output latency', () => {
  assert.equal(inputContextTime({ currentTime: 10, outputLatency: 0.02, baseLatency: 0.01 }, 900, 1000), 9.88);
  assert.equal(inputContextTime({ currentTime: 10, baseLatency: 0.01 }, undefined, 1000), 9.99);
});
