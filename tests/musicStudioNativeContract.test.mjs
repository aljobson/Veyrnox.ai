import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { MUSIC_STUDIO_ACTION_TYPES } from '../lib/musicStudioActions.mjs';
import {
  MUSIC_STUDIO_ASSISTANT_NATIVE_TRANSLATIONS,
  MUSIC_STUDIO_ASSISTANT_PLURAL_CATEGORIES,
  MUSIC_STUDIO_ASSISTANT_TRANSLATIONS,
} from '../lib/i18n/musicStudioAssistantTranslations.mjs';

const screen = readFileSync(new URL('../apps/mobile/src/app/(app)/beats/[id].tsx', import.meta.url), 'utf8');
const aiPanel = readFileSync(new URL('../apps/mobile/src/components/beats/ai/BeatAiPanel.tsx', import.meta.url), 'utf8');
const addTrackSheet = readFileSync(new URL('../apps/mobile/src/components/beats/MusicAddTrackSheet.tsx', import.meta.url), 'utf8');
const instrumentTray = readFileSync(new URL('../apps/mobile/src/components/beats/MusicInstrumentTray.tsx', import.meta.url), 'utf8');
const magic = readFileSync(new URL('../apps/mobile/src/lib/beatAi/magicGate.ts', import.meta.url), 'utf8');

test('native Music Editor opens AI editing from a compact icon surface and keeps Magic Bar hard off', () => {
  assert.match(screen, /bottomTool === 'ai' \? <BeatAiPanel doc=\{doc\} apply=\{apply\} disabled=\{aiLocked\} visible/);
  assert.match(screen, /onAdd=\{toggleAddTools\} onAi=\{toggleAiTools\}/);
  assert.match(screen, /subMenu=\{bottomTool === 'tracks'/);
  assert.match(aiPanel, /testID="music-ai-actions"/);
  assert.match(aiPanel, /testID="music-ai-context-slot"/);
  assert.match(aiPanel, /<BeatAiSheet[\s\S]*embedded/);
  for (const icon of ['magicWand', 'waveform', 'crosshair', 'arrowsHorizontal', 'scissors']) {
    assert.match(aiPanel, new RegExp(`icon: '${icon}'`));
  }
  assert.match(aiPanel, /MAGIC_BAR_ON_PHONE \? <BeatMagicBar/);
  assert.match(magic, /MAGIC_BAR_ON_PHONE = false/);
  assert.doesNotMatch(screen, /features\.magicBar/);
});

test('native AI editing is generation, project and visit fenced and fails closed', () => {
  assert.match(aiPanel, /identity\.current\.generation !== generation/);
  assert.match(aiPanel, /identity\.current\.id !== doc\.id/);
  assert.match(aiPanel, /session\.generation !== generation/);
  assert.match(aiPanel, /session\.id !== doc\.id/);
  assert.match(aiPanel, /session\.visit !== visit\.current/);
  assert.match(aiPanel, /\.catch\(\(\) => \{ if \(live\) setSession\(null\); \}\)/);
  assert.match(aiPanel, /new AbortController\(\)/);
  assert.match(aiPanel, /session\.controller\.abort\(\)/);
});

test('add track presents compact inline sources, keeps library separate and keeps drums inside instruments', () => {
  for (const source of ['device', 'record', 'instrument', 'sounds']) {
    assert.match(addTrackSheet, new RegExp(`testID="music-add-track-${source}"`));
  }
  assert.match(addTrackSheet, /icon="arrowUp"/);
  assert.match(addTrackSheet, /icon="microphone"/);
  assert.match(addTrackSheet, /icon="pianoKeys"/);
  assert.match(addTrackSheet, /icon="waveSine"/);
  assert.match(screen, /onLibrary=\{toggleLibraryTools\}/);
  assert.match(screen, /bottomTool === 'library' \? <BeatSongLibrarySheet inline/);
  assert.doesNotMatch(addTrackSheet, /BeatModal|music-add-track-drums/);
  assert.match(instrumentTray, /testID=\{`music-instrument-group-\$\{group\.id\}`\}/);
  assert.match(instrumentTray, /groups\[0\]\?\.id \?\? 'drums'/);
  assert.doesNotMatch(instrumentTray, /audition|icon="play"/);
});

test('native Studio catalogs load when the iPhone runtime omits Intl.PluralRules', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'PluralRules');
  try {
    Object.defineProperty(Intl, 'PluralRules', { configurable: true, writable: true, value: undefined });
    const fallback = await import(`../lib/i18n/musicStudioAssistantTranslations.mjs?no-plural-rules=${Date.now()}`);
    assert.equal(fallback.MUSIC_STUDIO_ASSISTANT_NATIVE_TRANSLATIONS.en['studioAssistant.tracks.one'], '{count} track in this beat.');
    assert.equal(fallback.MUSIC_STUDIO_ASSISTANT_NATIVE_TRANSLATIONS.ar['studioAssistant.tracks.zero'], 'لا توجد مسارات في هذا الإيقاع ({count}).');
    assert.equal(fallback.MUSIC_STUDIO_ASSISTANT_NATIVE_TRANSLATIONS.ja['studioAssistant.tracks.one'], undefined);
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'PluralRules', descriptor);
    else delete Intl.PluralRules;
  }
});

test('native Studio catalog imports without Intl.PluralRules and freezes the shipped ICU categories', () => {
  for (const locale of Object.keys(MUSIC_STUDIO_ASSISTANT_PLURAL_CATEGORIES)) {
    assert.deepEqual([...MUSIC_STUDIO_ASSISTANT_PLURAL_CATEGORIES[locale]].sort(),
      [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories].sort(), locale);
  }
  const moduleUrl = new URL('../lib/i18n/musicStudioAssistantTranslations.mjs', import.meta.url).href;
  const source = `Object.defineProperty(Intl, 'PluralRules', { value: undefined, configurable: true }); await import(${JSON.stringify(moduleUrl)});`;
  execFileSync(process.execPath, ['--input-type=module', '--eval', source]);
});

test('native mute and solo preserve the live engine and refusal result', () => {
  assert.match(screen, /const applied = apply\(operation, announce, \{ \.\.\.\(key \? \{ key \} : \{\}\), liveMix: true \}\)/);
  assert.match(screen, /if \(!applied\) return false/);
  assert.match(screen, /next\.tracks\.forEach\(x => mixOf\(x\.id, next\)\)/);
  assert.match(screen, /onMute=\{\(trackId, value\) => \{[\s\S]*mix\(trackId, d => setTrackMute\(d, trackId, value\)/);
  assert.match(screen, /onSolo=\{\(trackId, value\) => \{[\s\S]*mix\(trackId, d => setTrackSolo\(d, trackId, value\)/);
  assert.match(screen, /if \(recordingRef\.current\?\.locked\(\) && !options\.recordingCommit && !options\.liveMix\) return refuse/);
  assert.match(screen, /if \(midiRecordingRef\.current\?\.locked\(\) && !options\.recordingCommit && !options\.liveMix\) return refuse/);
});
