import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('media regression tools are exact-version binaries independent of apt mirrors', () => {
  assert.match(ci, /ffmpeg-static@5\.3\.0 ffprobe-static@3\.1\.0/);
  assert.match(ci, /echo "\$MEDIA_BIN" >> "\$GITHUB_PATH"/);
  assert.match(ci, /ffmpeg -version\n          ffprobe -version/);
  assert.doesNotMatch(ci, /apt-get/);
});
