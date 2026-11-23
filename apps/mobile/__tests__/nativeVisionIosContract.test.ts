import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const visionEngine = readFileSync(
  resolve(__dirname, '../modules/veyrnox-vision/ios/VisionEngine.swift'),
  'utf8',
);
const visionPlugin = require('../modules/veyrnox-vision/app.plugin.js') as {
  addMediaPipeGraphLinking(contents: string): string;
  MEDIAPIPE_LINK_MARKER: string;
};

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

test('keeps the MediaPipe graph archive force-loaded in generated iOS projects', () => {
  const podfile = `target 'Veyrnoxai' do\n  post_install do |installer|\n    react_native_post_install(installer)\n  end\nend\n`;
  const once = visionPlugin.addMediaPipeGraphLinking(podfile);
  const twice = visionPlugin.addMediaPipeGraphLinking(once);

  expect(once).toContain(visionPlugin.MEDIAPIPE_LINK_MARKER);
  expect(once).toContain("OTHER_LDFLAGS[sdk=iphonesimulator*]");
  expect(once).toContain('libMediaPipeTasksCommon_simulator_graph.a');
  expect(once).toContain("OTHER_LDFLAGS[sdk=iphoneos*]");
  expect(once).toContain('libMediaPipeTasksCommon_device_graph.a');
  expect(twice).toBe(once);
});
