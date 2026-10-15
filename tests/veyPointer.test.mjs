import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerPlacement, VEY_SIZE } from '../lib/veyPointer.js';

function check(rect, viewport, obstacle) {
  const result = pointerPlacement(rect, viewport, obstacle);
  const { position, facing, hand, point } = result;
  assert.ok(position.x >= 8 && position.x + VEY_SIZE.width <= viewport.width - 8);
  assert.ok(position.y >= 72 && position.y + VEY_SIZE.height <= viewport.height - 8);
  assert.ok(point.x >= rect.left && point.x <= rect.right);
  assert.ok(point.y >= rect.top && point.y <= rect.bottom);
  // Reconstruct the SVG's *actual* fingertip in screen pixels, including its
  // viewBox letterbox and mirrored body. No nominal centre-of-mascot proxy.
  const scale = VEY_SIZE.height / 170;
  const inset = (VEY_SIZE.width - 160 * scale) / 2;
  const localX = inset + hand.x * scale;
  assert.ok(Math.abs(position.x + (facing === 1 ? localX : VEY_SIZE.width - localX) - point.x) < 0.001);
  assert.ok(Math.abs(position.y + hand.y * scale - point.y) < 0.001);
  return result;
}
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('fingertip lands in the exact control on narrow, wide, scrolled and resized layouts', () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 643, height: 764 }, { width: 1440, height: 900 }]) {
    for (const r of [rect(48, 195, 13, 13), rect(32, 120, viewport.width - 64, 160), rect(36, 540, 50, 30), rect(viewport.width - 150, 160, 100, 40)]) check(r, viewport);
  }
});

test('tiny checkbox uses its centre; moving it moves Vey and the fingertip', () => {
  const viewport = { width: 643, height: 764 };
  const first = check(rect(48, 195, 13, 13), viewport);
  const moved = check(rect(48, 340, 13, 13), viewport);
  assert.deepEqual(first.point, { x: 54.5, y: 201.5 });
  assert.equal(moved.point.y - first.point.y, 145);
  assert.notDeepEqual(first.position, moved.position);
});

test('placement keeps Vey off the input and prefers a position outside the guide', () => {
  const viewport = { width: 643, height: 764 };
  const input = rect(32, 180, 579, 150);
  const guide = rect(301, 453, 330, 295);
  const { position } = check(input, viewport, guide);
  assert.ok(position.y + VEY_SIZE.height <= input.top || position.y >= input.bottom);
  assert.ok(position.x + VEY_SIZE.width <= guide.left || position.x >= guide.right || position.y + VEY_SIZE.height <= guide.top || position.y >= guide.bottom);
});
