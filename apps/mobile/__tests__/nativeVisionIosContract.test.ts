import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const visionEngine = readFileSync(
  resolve(__dirname, '../modules/veyrnox-vision/ios/VisionEngine.swift'),
  'utf8',
);

test('bounds MediaPipe float mask pointers using the documented pixel dimensions', () => {
  const dimensionGuard = visionEngine.indexOf(
    'guard (8...512).contains(mask.width), (8...512).contains(mask.height)',
  );
  const pixelCount = visionEngine.indexOf(
    'let pixelCount = mask.width * mask.height',
  );

  expect(dimensionGuard).toBeGreaterThanOrEqual(0);
  expect(pixelCount).toBeGreaterThan(dimensionGuard);
  expect(visionEngine).toContain('let pixelCount = mask.width * mask.height');
  expect(visionEngine).toContain(
    'UnsafeBufferPointer(start: mask.float32Data, count: pixelCount)',
  );
  expect(visionEngine).not.toContain('mask.float32Data.count');
});
