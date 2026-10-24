import test from 'node:test';
import assert from 'node:assert/strict';
import { PEEK_MS, PEEK_Y, PEEK_ROTATE, PEEK_TIMES,
  HOP_COOLDOWN_MS, HOP_SCROLL_PX, PAYWALL_MOODS, PERCH_MIN_VIEWPORT,
  nextScrollState, paywallMoodFor, perchPlacement, perchSide, readingSection,
} from '../lib/veyMotion.js';
import { VEY_SIZE } from '../lib/veyPointer.js';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const start = { y: 0, travelled: 0, lastHopAt: -HOP_COOLDOWN_MS };

test('Vey hops once the page has moved far enough, in either direction, and not before', () => {
  const small = nextScrollState(start, HOP_SCROLL_PX - 1, 0);
  assert.equal(small.hop, false);
  assert.equal(small.state.travelled, HOP_SCROLL_PX - 1);
  const far = nextScrollState(small.state, HOP_SCROLL_PX, 10);
  assert.equal(far.hop, true);
  assert.equal(far.state.travelled, 0);
  const up = nextScrollState({ ...start, y: 1000 }, 1000 - HOP_SCROLL_PX, 0);
  assert.equal(up.hop, true);
});

test('a long scroll is a few hops, not one per frame', () => {
  let state = start;
  let hops = 0;
  for (let frame = 1; frame <= 600; frame += 1) {
    const step = nextScrollState(state, frame * 40, frame * 16);
    state = step.state;
    if (step.hop) hops += 1;
  }
  // 600 frames last 9.6 s: no more than one hop per cooldown.
  assert.ok(hops >= 3 && hops <= Math.ceil(9600 / HOP_COOLDOWN_MS) + 1, `hops: ${hops}`);
});

test('the distance keeps counting through the cooldown, so the next hop is ready when it ends', () => {
  const first = nextScrollState(start, HOP_SCROLL_PX, 0);
  assert.equal(first.hop, true);
  const resting = nextScrollState(first.state, HOP_SCROLL_PX * 2, 100);
  assert.equal(resting.hop, false);
  assert.equal(nextScrollState(resting.state, HOP_SCROLL_PX * 2, HOP_COOLDOWN_MS).hop, true);
});

test('the section crossing the reading line is the one being read', () => {
  const items = [{ id: 'a', top: -600, bottom: 100 }, { id: 'b', top: 100, bottom: 900 }, { id: 'c', top: 900, bottom: 1700 }];
  assert.equal(readingSection(items, 800), 'b');
  assert.equal(readingSection(items, 150), 'a');
  assert.equal(readingSection([{ id: 'a', top: 600, bottom: 900 }], 800), null);
  assert.equal(readingSection([], 800), null);
});

test('Vey lands in the gutter beside the content, level with the reading band, facing it', () => {
  const viewport = { width: 1600, height: 900 };
  const content = rect(150, -300, 1300, 1400);
  const left = perchPlacement({ rect: content, viewport, side: 'start' });
  assert.equal(left.facing, 1);
  assert.ok(left.position.x + VEY_SIZE.width < content.left);
  const right = perchPlacement({ rect: content, viewport, side: 'end' });
  assert.equal(right.facing, -1);
  assert.ok(right.position.x > content.right);
  for (const { position } of [left, right]) {
    assert.ok(position.x >= 8 && position.x + VEY_SIZE.width <= viewport.width - 8);
    assert.ok(position.y >= 72 && position.y + VEY_SIZE.height <= viewport.height - 8);
  }
});

test('right-to-left pages mirror the sides', () => {
  const viewport = { width: 1600, height: 900 };
  const content = rect(150, 0, 1300, 900);
  const start = perchPlacement({ rect: content, viewport, side: 'start', rtl: true });
  assert.equal(start.facing, -1);
  assert.ok(start.position.x > content.right);
});

test('Vey never lands on content: no gutter, or a small window, means it stays where it is', () => {
  const content = rect(0, 0, 1300, 900);
  assert.equal(perchPlacement({ rect: content, viewport: { width: 1300, height: 900 }, side: 'start' }), null);
  assert.equal(perchPlacement({ rect: rect(20, 0, 1000, 900), viewport: { width: PERCH_MIN_VIEWPORT - 1, height: 900 }, side: 'start' }), null);
  assert.equal(perchPlacement({ rect: rect(40, 0, 1300, 900), viewport: { width: 1380, height: 900 }, side: 'start' }), null);
  assert.equal(perchPlacement({ rect: null, viewport: { width: 1600, height: 900 } }), null);
});

test('landings alternate sides', () => {
  assert.deepEqual([0, 1, 2, 3].map(perchSide), ['start', 'end', 'start', 'end']);
});

test('the paywall companion has a mood for everything the reader does, and every held mood ends', () => {
  for (const event of ['welcomeFirst', 'welcomeLow', 'hover', 'leave', 'select', 'consent', 'checkout', 'error', 'ambient']) {
    const { mood, holdMs } = paywallMoodFor(event);
    assert.ok(mood && Number.isInteger(holdMs) && holdMs >= 0, event);
  }
  // A mood with no end is one that something else (leaving, a checkout) is waiting to clear.
  const sticky = Object.entries(PAYWALL_MOODS).filter(([, { holdMs }]) => holdMs === 0).map(([event]) => event).sort();
  assert.deepEqual(sticky, ['checkout', 'hover', 'leave']);
  assert.equal(paywallMoodFor('unknown').mood, 'idle');
  assert.equal(paywallMoodFor('error').mood, 'worried');
  assert.equal(paywallMoodFor('select').mood, 'peek', 'choosing a pack or plan: Vey climbs up and peeks over the card');
  assert.equal(paywallMoodFor('select').holdMs, PEEK_MS);
});

test('choosing a pack or plan: Vey starts hidden behind the card, shows only its head, looks around, then climbs over', () => {
  assert.equal(PEEK_Y.length, PEEK_ROTATE.length);
  assert.equal(PEEK_Y.length, PEEK_TIMES.length);
  const SPRITE_HEIGHT = 88;
  assert.ok(PEEK_Y[0] >= SPRITE_HEIGHT, 'starts fully below the card edge');
  assert.ok(PEEK_Y[1] > 0 && PEEK_Y[1] < SPRITE_HEIGHT, 'then only the head shows over the edge');
  assert.equal(PEEK_Y.at(-1), 0, 'ends standing on top of the card');
  assert.ok(PEEK_ROTATE.some((r) => r < 0) && PEEK_ROTATE.some((r) => r > 0), 'looks left and right while peeking');
  assert.ok(PEEK_TIMES.every((t, i) => i === 0 || t > PEEK_TIMES[i - 1]) && PEEK_TIMES[0] === 0 && PEEK_TIMES.at(-1) === 1);
});
