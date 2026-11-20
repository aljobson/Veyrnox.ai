import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the Vey help box is not mounted at phone widths on the web', async () => {
  const source = await readFile(new URL('../app/veyrnox/_components/MascotAssistant.jsx', import.meta.url), 'utf8');
  assert.match(source, /const DESKTOP_QUERY = '\(min-width: 640px\)'/);
  assert.match(source, /useSyncExternalStore\(subscribeDesktop, isDesktopViewport, \(\) => false\)/);
  assert.match(source, /return desktop \? <VeyHelper \/> : null;/);
});
