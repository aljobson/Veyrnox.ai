import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileGuideScroll, pointerPlacement, VEY_SIZE } from '../lib/veyPointer.js';

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

test('mobile controls scroll clear of the dock and expanded details, not desktop or unrelated areas', () => {
  const control = rect(32, 640, 100, 44);
  assert.equal(mobileGuideScroll(control, rect(8, 650, 330, 186), { width: 390 }), 46);
  assert.equal(mobileGuideScroll(control, rect(8, 480, 330, 356), { width: 390 }), 216);
  assert.equal(mobileGuideScroll(rect(32, 420, 100, 44), rect(8, 650, 330, 186), { width: 390 }), 0);
  assert.equal(mobileGuideScroll(control, rect(8, 650, 330, 186), { width: 640 }), 0);
  assert.equal(mobileGuideScroll(control, rect(200, 650, 180, 186), { width: 390 }), 0);
  assert.equal(mobileGuideScroll(control, null, { width: 390 }), 0);
});

test('Vey is half the original dimensions and retains a touch-friendly launcher', async () => {
  assert.deepEqual(VEY_SIZE, { width: 112 / 2, height: 116 / 2 });
  assert.ok(VEY_SIZE.width >= 44 && VEY_SIZE.height >= 44);
  const { readFile } = await import('node:fs/promises');
  const component = await readFile(new URL('../app/veyrnox/_components/MascotAssistant.jsx', import.meta.url), 'utf8');
  assert.match(component, /width: CHARACTER.width, height: CHARACTER.height, scaleX: facing/);
  assert.doesNotMatch(component, /h-\[116px\]|w-\[112px\]/);
});

test('fingertip lands in the exact control on narrow, wide, scrolled and resized layouts', () => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 643, height: 764 }, { width: 1440, height: 900 }]) {
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
