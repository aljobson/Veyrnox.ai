import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../apps/mobile/src/app/(app)/beats/[id].tsx', import.meta.url), 'utf8');
const aiPanel = readFileSync(new URL('../apps/mobile/src/components/beats/ai/BeatAiPanel.tsx', import.meta.url), 'utf8');
const addTrackSheet = readFileSync(new URL('../apps/mobile/src/components/beats/MusicAddTrackSheet.tsx', import.meta.url), 'utf8');
const simpleEditorChrome = readFileSync(new URL('../apps/mobile/src/components/editor/SimpleEditorChrome.tsx', import.meta.url), 'utf8');
const magic = readFileSync(new URL('../apps/mobile/src/lib/beatAi/magicGate.ts', import.meta.url), 'utf8');

test('native Music Editor opens AI editing from a compact icon surface and keeps Magic Bar hard off', () => {
  assert.match(screen, /<BeatAiPanel doc=\{doc\} apply=\{apply\} disabled=\{locked\} visible=\{aiToolsOpen\}/);
  assert.match(screen, /onAdd=\{\(\) => setAddTrackOpen\(true\)\} onAi=\{\(\) => setAiToolsOpen\(true\)\}/);
  assert.match(aiPanel, /testID="music-ai-actions"/);
  assert.match(aiPanel, /AI_ACTIONS\.map\([\s\S]*iconOnly/);
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

test('add track presents the five music sources as compact choices', () => {
  for (const [source, icon] of [
    ['library', 'folder'],
    ['device', 'arrowUp'],
    ['record', 'microphone'],
    ['drums', 'waveform'],
    ['instrument', 'pianoKeys'],
  ]) {
    assert.match(addTrackSheet, new RegExp(`id: '${source}', icon: '${icon}'`));
  }
  assert.match(addTrackSheet, /<SimpleEditorSheet testID="music-add-track-sheet"[\s\S]*rows=\{rows\}/);
  assert.match(simpleEditorChrome, /rows\.map\(\(row\) => <Pressable/);
  assert.match(simpleEditorChrome, /onPress=\{\(\) => \{ onClose\(\); if \(row\.afterClose\)/);
});

test('native mute and solo preserve the live engine and refusal result', () => {
  assert.match(screen, /const applied = apply\(operation, announce, \{ \.\.\.\(key \? \{ key \} : \{\}\), liveMix: true \}\)/);
  assert.match(screen, /if \(!applied\) return false/);
  assert.match(screen, /next\.tracks\.forEach\(x => mixOf\(x\.id, next\)\)/);
  assert.match(screen, /onMute=\{v => mix\(track\.id, d => setTrackMute\(d, track\.id, v\)/);
  assert.match(screen, /onSolo=\{v => mix\(track\.id, d => setTrackSolo\(d, track\.id, v\)/);
  assert.match(screen, /if \(recordingRef\.current\?\.locked\(\) && !options\.recordingCommit && !options\.liveMix\) return refuse/);
  assert.match(screen, /if \(midiRecordingRef\.current\?\.locked\(\) && !options\.recordingCommit && !options\.liveMix\) return refuse/);
});
