import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackMeter } from '../lib/cinema/playbackMeter.js';

function clock() {
  let ms = 0;
  const meter = createPlaybackMeter(() => ms);
  return { meter, advance: (seconds) => { ms += seconds * 1000; } };
}

test('opening a player and leaving an ended video visible never accrues watch time', () => {
  const { meter, advance } = clock();
  advance(720);
  assert.equal(meter.takeSeconds(), 0);
  assert.equal(meter.isPlaying(), false);
  meter.setPlaying(true);
  advance(6);
  meter.setPlaying(false);
  assert.equal(meter.takeSeconds(), 6);
  advance(720);
  assert.equal(meter.takeSeconds(), 0);
  assert.equal(meter.isPlaying(), false);
});

test('pause, buffering and seeking exclude idle time while preserving earned fractions', () => {
  const { meter, advance } = clock();
  for (const idle of ['pause', 'waiting', 'seeking']) {
    meter.setPlaying(true);
    advance(2.5);
    meter.setPlaying(false);
    advance(120);
  }
  assert.equal(meter.takeSeconds(), 7);
  meter.setPlaying(true);
  advance(0.5);
  assert.equal(meter.takeSeconds(), 1);
});

test('a hidden playing tab cannot accrue time or qualify for token renewal', () => {
  const { meter, advance } = clock();
  meter.setPlaying(true);
  advance(3);
  meter.setVisible(false);
  advance(900);
  assert.equal(meter.isPlaying(), false);
  assert.equal(meter.takeSeconds(), 3);
  meter.setVisible(true);
  advance(7);
  assert.equal(meter.isPlaying(), true);
  assert.equal(meter.takeSeconds(), 7);
});

test('each beat consumes its time once and delayed browser timers remain bounded', () => {
  const { meter, advance } = clock();
  meter.setPlaying(true);
  advance(30);
  assert.equal(meter.takeSeconds(), 30);
  assert.equal(meter.takeSeconds(), 0);
  advance(300);
  assert.equal(meter.takeSeconds(), 60);
  assert.equal(meter.takeSeconds(), 0);
  meter.setPlaying(false);
  advance(30);
  assert.equal(meter.takeSeconds(), 0);
});
