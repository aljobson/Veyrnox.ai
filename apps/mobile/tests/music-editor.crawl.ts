import { test } from '@e2e-dev/mobile';
import { expect } from 'e2e';
import { openFirstRun } from './helpers.js';

const proxyPort = process.env.E2E_PROXY_PORT ?? '8803';
const MOCK = process.env.E2E_FAULT_CONTROL ?? `http://localhost:${proxyPort}`;
const CONTROL = `${MOCK}/__fault`;
const pause = (ms = 650) => new Promise(resolve => setTimeout(resolve, ms));
const SEEDED_SONGS = [
  { id: '66666666-6666-4666-8666-666666666661', title: 'Midnight Keys', versionId: '55555555-5555-4555-8555-555555555551' },
  { id: '66666666-6666-4666-8666-666666666662', title: 'Neon Guitar', versionId: '55555555-5555-4555-8555-555555555552' },
] as const;

async function setFault(mode: string, match = '') {
  const response = await fetch(`${CONTROL}?mode=${encodeURIComponent(mode)}&match=${encodeURIComponent(match)}`);
  expect(response.ok, `fault control must accept ${mode}`).toBe(true);
  const value = await response.json() as { mode?: string; match?: string };
  expect(value.mode).toBe(mode);
  expect(value.match ?? '').toBe(match);
}

async function setLibraryFixture(fixture: 'default' | 'empty') {
  const response = await fetch(`${MOCK}/__mock/music-library?fixture=${fixture}`, { method: 'POST' });
  expect(response.ok, `mock library must accept ${fixture}`).toBe(true);
  expect((await response.json() as { fixture?: string }).fixture).toBe(fixture);
}

type FaultLogRow = { t?: number; path?: string; fault?: string };

async function faultLogSince(since: number) {
  const response = await fetch(`${CONTROL}/log`);
  expect(response.ok, 'fault log must be readable').toBe(true);
  return ((await response.json()) as FaultLogRow[]).filter(row => (row.t ?? 0) >= since);
}

async function assertSeededSongDetailContract() {
  for (const fixture of SEEDED_SONGS) {
    const response = await fetch(`${MOCK}/api/v1/music/songs/${fixture.id}`);
    expect(response.status, `${fixture.title} detail must resolve`).toBe(200);
    const song = await response.json() as Record<string, unknown>;
    expect(song).toMatchObject({
      id: fixture.id, title: fixture.title, version_id: fixture.versionId,
      current_version: { id: fixture.versionId, version_number: 1, operation: 'generate', parent_version_id: null },
      versions: [{ id: fixture.versionId, version_number: 1, is_current: true }],
      actions: ['stems', 'target_stems', 'extend', 'replace'],
      provenance: { source: 'development_fixture' },
    });
  }
  const missing = await fetch(`${MOCK}/api/v1/music/songs/66666666-6666-4666-8666-666666666669`);
  expect(missing.status, 'unknown song detail must not fall through to a fixture').toBe(404);
  expect(await missing.json()).toEqual({ error: 'not_found' });
}

test('Music Editor inline tools remain visible and screenshot every touch', { tags: ['crawl', 'music-editor'] }, async ({ app, device, screen }) => {
  await setFault('pass');
  await setLibraryFixture('default');
  await assertSeededSongDetailContract();
  let shot = 0;
  const snap = async (name: string) => { await app.screenshot(`music-editor-${String(shot++).padStart(2, '0')}-${name}`); };
  const touch = async (name: string, action: () => Promise<unknown>) => {
    await action();
    await pause();
    await snap(name);
  };

  try {
  await openFirstRun(app, device, screen, snap);
  await snap('first-run');
  await touch('first-run-audio', () => screen.getByRole('radio', 'Make audio').tap());
  await touch('first-run-private', () => screen.getByRole('radio', 'Just for me').tap());
  await touch('first-run-pro', () => screen.getByRole('radio', 'Creative pro').tap());
  await expect(screen.getByRole('button', 'Start creating')).toBeVisible({ timeout: 15_000 });
  await touch('first-run-start', () => screen.getByRole('button', 'Start creating').tap());
  await expect(screen.getByRole('button', 'Music editor')).toBeVisible({ timeout: 30_000 });
  await touch('first-run-music-editor', () => screen.getByRole('button', 'Music editor').tap());
  await expect(screen.getByTestId('beat-editor-shell')).toBeVisible({ timeout: 30_000 });
  await snap('opened');
  const libraryOpenSince = Date.now();
  await touch('library-inline', () => screen.getByTestId('beat-editor-library').tap());
  await expect(screen.getByTestId('beat-song-library-inline')).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByRole('button', { name: /^Audition Midnight Keys$/ })).toBeVisible({ timeout: 15_000 });
  const libraryOpened = await faultLogSince(libraryOpenSince);
  expect(libraryOpened.some(row => row.path === '/api/v1/music/songs' && row.fault === 'pass'),
    'Library open must read through the proxy during this interaction').toBe(true);
  await touch('library-audition', () => screen.getByRole('button', { name: /^Audition Midnight Keys$/ }).tap());
  await expect(screen.getByRole('button', { name: /^Stop Midnight Keys$/ })).toBeVisible({ timeout: 15_000 });
  await touch('library-preview-stop', () => screen.getByRole('button', { name: /^Stop Midnight Keys$/ }).tap());
  await expect(screen.getByRole('button', { name: /^Audition Midnight Keys$/ })).toBeVisible({ timeout: 15_000 });

  // Reopen to clear the decoded-song cache, then fail the signed media request itself.
  // This proves that preview recovery covers the /jobs/:id/asset -> /audio.wav path,
  // rather than only the owned-song list request.
  await touch('library-close-before-media-error', () => screen.getByTestId('beat-editor-library').tap());
  await setFault('500', '/api/v1/jobs/');
  await touch('library-media-error-open', () => screen.getByTestId('beat-editor-library').tap());
  await expect(screen.getByRole('button', { name: /^Audition Midnight Keys$/ })).toBeVisible({ timeout: 15_000 });
  const mediaFaultSince = Date.now();
  await touch('library-media-error', () => screen.getByRole('button', { name: /^Audition Midnight Keys$/ }).tap());
  const mediaError = screen.getByText('Music Library could not respond. Retry when ready.');
  expect(await mediaError.count(), 'Media signing failure must render an inline Library error').toBeGreaterThan(0);
  await expect(mediaError.first()).toBeVisible({ timeout: 15_000 });
  const mediaFaulted = await faultLogSince(mediaFaultSince);
  expect(mediaFaulted.some(row => row.path?.startsWith('/api/v1/jobs/') && row.fault === '500'),
    'Library media 500 must be observed by the proxy').toBe(true);
  await setFault('pass');
  await touch('library-media-retry', () => screen.getByRole('button', { name: /^Audition Midnight Keys$/ }).tap());
  await expect(screen.getByRole('button', { name: /^Stop Midnight Keys$/ })).toBeVisible({ timeout: 15_000 });
  await touch('library-media-recovery-stop', () => screen.getByRole('button', { name: /^Stop Midnight Keys$/ }).tap());
  await expect(screen.getByRole('button', { name: /^Audition Midnight Keys$/ })).toBeVisible({ timeout: 15_000 });
  await touch('library-add', () => screen.getByRole('button', { name: /^Add Midnight Keys/ }).tap());
  await expect(screen.getByTestId('beat-editor-submenu')).not.toBeVisible({ timeout: 15_000 });
  const addedRegion = screen.getByRole('button', { name: /^Audio, Midnight Keys,/ });
  expect(await addedRegion.count(), 'Library add must create exactly one Midnight Keys audio region').toBe(1);
  await expect(addedRegion).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByTestId('arrangement-grid')).toBeVisible();
  const barLines = screen.getByTestId('arrangement-bar-line');
  const beatLines = screen.getByTestId('arrangement-beat-line');
  expect(await barLines.count(), 'Arrangement must render bar grid lines').toBeGreaterThan(0);
  expect(await beatLines.count(), 'Arrangement must render beat grid lines').toBeGreaterThan(0);
  await expect(barLines.first()).toBeVisible();
  await expect(beatLines.first()).toBeVisible();
  await expect(screen.getByTestId('playhead')).toBeVisible();

  await setFault('500', '/api/v1/music/songs');
  const libraryFaultSince = Date.now();
  await touch('library-error-open', () => screen.getByTestId('beat-editor-library').tap());
  const faulted = await faultLogSince(libraryFaultSince);
  expect(faulted.some(row => row.path === '/api/v1/music/songs' && row.fault === '500'), 'Library 500 must be observed by the proxy').toBe(true);
  await expect(screen.getByRole('button', 'Retry')).toBeVisible({ timeout: 15_000 });
  await setFault('pass');
  await touch('library-error-retry', () => screen.getByRole('button', 'Retry').tap());
  await expect(screen.getByRole('button', { name: /^Audition Midnight Keys$/ })).toBeVisible({ timeout: 15_000 });
  await touch('library-error-close', () => screen.getByTestId('beat-editor-library').tap());
  await setLibraryFixture('empty');
  await touch('library-empty-open', () => screen.getByTestId('beat-editor-library').tap());
  await expect(screen.getByText('No owned songs yet')).toBeVisible({ timeout: 15_000 });
  await touch('library-empty-close', () => screen.getByTestId('beat-editor-library').tap());
  await setLibraryFixture('default');

  await touch('add-tray', () => screen.getByTestId('beat-editor-add-track').tap());
  await expect(screen.getByTestId('music-add-track-tray')).toBeVisible();
  await touch('device-import-picker', () => screen.getByTestId('music-add-track-device').tap());
  await touch('device-import-cancel', () => screen.getByRole('button', 'Cancel').tap({ timeout: 15_000 }));
  await expect(screen.getByTestId('beat-editor-shell')).toBeVisible({ timeout: 15_000 });
  await touch('add-tray-reopen', () => screen.getByTestId('beat-editor-add-track').tap());
  await touch('instrument-groups', () => screen.getByTestId('music-add-track-instrument').tap());
  await expect(screen.getByTestId('music-instrument-groups')).toBeVisible();
  await touch('instrument-drums', () => screen.getByTestId('music-instrument-group-drums').tap());
  await touch('instrument-bass', () => screen.getByTestId('music-instrument-group-bass').tap());
  await touch('instrument-piano', () => screen.getByTestId('music-instrument-group-piano').tap());
  await touch('instrument-back', () => screen.getByTestId('music-instrument-back').tap());
  await touch('instrument-groups-reopen', () => screen.getByTestId('music-add-track-instrument').tap());
  await touch('instrument-drums-add', () => screen.getByTestId('music-instrument-add-drums-acoustic').tap());
  await expect(screen.getByTestId('beat-editor-shell')).toBeVisible();
  await touch('add-tray-record', () => screen.getByTestId('beat-editor-add-track').tap());
  await touch('record-track-added', () => screen.getByTestId('music-add-track-record').tap());

  await touch('play', () => screen.getByTestId('beat-editor-play').tap());
  await touch('stop', () => screen.getByTestId('beat-editor-play').tap());

  await touch('mixer', () => screen.getByTestId('beat-editor-mixer').tap());
  await expect(screen.getByTestId('music-mixer-tray')).toBeVisible();
  // Read the adjustable itself. On iOS an accessible slider owns its children,
  // so nested visual readouts are intentionally absent from the XCUITest tree.
  const initialGain = await screen.getByTestId('music-mixer-gain').inputValue();
  const initialPan = await screen.getByTestId('music-mixer-pan').inputValue();
  // Gain begins at 100%; use a point safely inside the left quarter of its
  // element-relative hit area so the gesture cannot land on the adjacent Pan cell.
  await touch('mixer-gain', () => screen.getByTestId('music-mixer-gain').tap({ position: { x: 40, y: 40 } }));
  await touch('mixer-pan', () => screen.getByTestId('music-mixer-pan').tap({ position: { x: 80, y: 40 } }));
  const changedGain = await screen.getByTestId('music-mixer-gain').inputValue();
  const changedPan = await screen.getByTestId('music-mixer-pan').inputValue();
  expect(changedGain, 'Mixer gain touch must change its displayed value').not.toBe(initialGain);
  expect(changedPan, 'Mixer pan touch must change its displayed value').not.toBe(initialPan);
  await touch('mixer-mute', () => screen.getByTestId('music-mixer-mute').tap());
  await touch('mixer-solo', () => screen.getByTestId('music-mixer-solo').tap());
  await touch('mixer-tools', () => screen.getByTestId('music-mixer-track-tools').tap());
  await touch('mixer-tools-close', () => screen.getByTestId('music-mixer-track-tools').tap());
  await touch('mixer-advanced', () => screen.getByTestId('music-mixer-advanced').tap());
  await expect(screen.getByTestId('music-mixer-advanced-panel')).toBeVisible();
  await touch('mixer-track-details', () => screen.getByTestId('music-mixer-selected-track-details').tap());
  await touch('mixer-show-gain-lane', () => screen.getByRole('button', 'Show gain lane').tap());
  await touch('mixer-add-automation-point', () => screen.getByRole('button', 'Add point').tap());
  await expect(screen.getByTestId('music-mixer-gain')).toBeDisabled();
  await expect(screen.getByTestId('music-mixer-automation-lock')).toBeVisible();
  await touch('mixer-clear-automation', () => screen.getByRole('button', 'Clear lane').tap());
  await expect(screen.getByTestId('music-mixer-gain')).toBeEnabled();
  await touch('mixer-advanced-close', () => screen.getByTestId('music-mixer-advanced').tap());
  await touch('mixer-close', () => screen.getByTestId('beat-editor-mixer').tap());
  await touch('mixer-persistence-reopen', () => screen.getByTestId('beat-editor-mixer').tap());
  await expect(screen.getByTestId('music-mixer-gain')).toHaveValue(changedGain);
  await expect(screen.getByTestId('music-mixer-pan')).toHaveValue(changedPan);
  await expect(screen.getByTestId('music-mixer-mute')).toBeSelected();
  await expect(screen.getByTestId('music-mixer-solo')).toBeSelected();
  await snap('mixer-persistence-verified');
  const midiTrackTab = screen.getByRole('tab', 'Acoustic kit');
  await touch('mixer-select-midi', () => midiTrackTab.tap());
  await expect(midiTrackTab).toBeSelected();
  await touch('mixer-persistence-close', () => screen.getByTestId('beat-editor-mixer').tap());
  const midiTrackHeader = screen.getByRole('button', 'Acoustic kit');
  await touch('editor-select-midi', () => midiTrackHeader.tap());
  await expect(midiTrackHeader).toBeSelected();

  await setFault('500', '/api/v1/music/generation-quotes');
  const aiFaultSince = Date.now();
  await touch('ai-error-open', () => screen.getByTestId('beat-editor-ai').tap());
  const aiFaulted = await faultLogSince(aiFaultSince);
  expect(aiFaulted.some(row => row.path === '/api/v1/music/generation-quotes' && row.fault === '500'), 'AI 500 must be observed by the proxy').toBe(true);
  await expect(screen.getByTestId('music-ai-retry')).toBeVisible({ timeout: 15_000 });
  await setFault('pass');
  await touch('ai-error-retry', () => screen.getByTestId('music-ai-retry').tap());
  await expect(screen.getByTestId('music-ai-editor')).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByTestId('music-ai-actions')).toBeVisible({ timeout: 15_000 });
  for (const operation of ['stems', 'targetStems', 'extend', 'replace', 'generate']) {
    await touch(`ai-${operation}`, () => screen.getByTestId(`music-ai-${operation}`).tap());
  }
  await screen.getByLabel('Describe the part').fill('A warm four-bar piano phrase');
  await snap('ai-prompt-filled');
  await touch('ai-price', () => screen.getByTestId('music-ai-submit').tap());
  await expect(screen.getByRole('button', 'Confirm once')).toBeVisible({ timeout: 15_000 });
  const aiSubmitSince = Date.now();
  await touch('ai-confirm', () => screen.getByRole('button', 'Confirm once').tap());
  const aiSubmitted = await faultLogSince(aiSubmitSince);
  expect(aiSubmitted.some(row => row.path === '/api/v1/music/generations'), 'AI submit must read through the fault-proxy stack').toBe(true);
  const midiPanelRecord = screen.getByTestId('beat-midi-panel-record');
  await touch('ai-lock-reveal-midi', () => screen.scrollUntilVisible(midiPanelRecord, {
    direction: 'down', momentum: 'slow', timeout: 15_000,
  }));
  await expect(midiPanelRecord).toBeVisible({ timeout: 15_000 });
  await touch('ai-lock-start-midi', () => midiPanelRecord.tap());
  await expect(screen.getByTestId('music-ai-editor')).not.toBeVisible({ timeout: 15_000 });
  await expect(screen.getByTestId('beat-editor-ai')).toBeDisabled();
  await touch('ai-lock-stop-midi', () => screen.getByTestId('beat-midi-record-control').tap());

  await device.setOrientation('landscape-left');
  await pause(1_000);
  await snap('landscape');
  await touch('landscape-mixer', () => screen.getByTestId('beat-editor-mixer').tap());
  await expect(screen.getByTestId('music-mixer-tray')).toBeVisible();
  await touch('landscape-mixer-close-before-ai', () => screen.getByTestId('beat-editor-mixer').tap());
  await touch('landscape-left-ai', () => screen.getByTestId('beat-editor-ai').tap());
  await screen.getByLabel('Describe the part').fill('A warm landscape piano phrase');
  await expect(screen.getByLabel('Describe the part')).toBeVisible();
  await expect(screen.getByTestId('music-ai-submit')).toBeVisible();
  await snap('landscape-left-ai-prompt');
  await touch('landscape-left-ai-close', () => screen.getByTestId('beat-editor-ai').tap());
  await touch('landscape-mixer-reopen', () => screen.getByTestId('beat-editor-mixer').tap());
  await device.setOrientation('landscape-right');
  await pause(1_000);
  await snap('landscape-right');
  await touch('landscape-mixer-close', () => screen.getByTestId('beat-editor-mixer').tap());
  await touch('landscape-library', () => screen.getByTestId('beat-editor-library').tap());
  await expect(screen.getByTestId('beat-song-library-inline')).toBeVisible({ timeout: 15_000 });
  await screen.getByLabel('Search owned songs').fill('Midnight');
  await expect(screen.getByLabel('Search owned songs')).toBeVisible();
  await expect(screen.getByRole('button', { name: /^Audition Midnight Keys$/ })).toBeVisible();
  await snap('landscape-library-search-filled');
  await touch('landscape-library-close', () => screen.getByTestId('beat-editor-library').tap());
  await touch('landscape-ai', () => screen.getByTestId('beat-editor-ai').tap());
  await expect(screen.getByTestId('music-ai-editor')).toBeVisible({ timeout: 15_000 });
  await screen.getByLabel('Describe the part').fill('A warm landscape guitar phrase');
  await expect(screen.getByLabel('Describe the part')).toBeVisible();
  await expect(screen.getByTestId('music-ai-submit')).toBeVisible();
  await snap('landscape-right-ai-prompt');
  await touch('landscape-ai-close', () => screen.getByTestId('beat-editor-ai').tap());
  await device.setOrientation('portrait');
  await pause(1_000);
  await snap('portrait-restored');

  } finally {
    await setFault('pass');
    await setLibraryFixture('default');
  }
});
