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
const component = readFileSync(new URL('../apps/mobile/src/components/beats/BeatStudioAssistant.tsx', import.meta.url), 'utf8');
const magic = readFileSync(new URL('../apps/mobile/src/lib/beatAi/magicGate.ts', import.meta.url), 'utf8');
const catalogs = readFileSync(new URL('../apps/mobile/src/lib/i18n/catalogs.ts', import.meta.url), 'utf8');

test('native Studio actions share the web planner and keep Magic Bar private and hard off', () => {
  assert.deepEqual([...MUSIC_STUDIO_ACTION_TYPES], ['set_tempo', 'set_track_mute', 'set_track_solo', 'set_view', 'select_pattern']);
  assert.match(component, /musicStudioActions\.mjs/);
  assert.match(screen, /magicBar=\{MAGIC_BAR_ON_PHONE\}/);
  assert.match(magic, /MAGIC_BAR_ON_PHONE = false/);
  assert.doesNotMatch(screen, /features\.magicBar/);
});

test('native entitlement visibility is generation fenced and fails closed', () => {
  assert.match(screen, /const expectedGeneration = generation/);
  assert.match(screen, /authRef\.current\.generation === expectedGeneration/);
  assert.match(screen, /value\.features\.studioChat[\s\S]*setStudioChatGate/);
  assert.match(screen, /studioChatGate\.generation === generation/);
  assert.match(screen, /catch\(\(\) => undefined\)/);
  assert.match(screen, /announce=\{setSaid\}/);
  assert.match(component, /announce\(message\(planned\)\)/);
  assert.doesNotMatch(component, /accessibilityLiveRegion/);
});

test('native English catalog merges Studio action copy instead of exposing keys', () => {
  assert.equal(MUSIC_STUDIO_ASSISTANT_TRANSLATIONS.en['studioAssistant.title'], 'Studio actions');
  assert.equal(MUSIC_STUDIO_ASSISTANT_NATIVE_TRANSLATIONS.en['studioAssistant.title'], 'Studio actions');
  assert.match(catalogs, /en: \{ \.\.\.en, \.\.\.MUSIC_STUDIO_ASSISTANT_NATIVE_TRANSLATIONS\.en \}/);
  assert.match(catalogs, /CATALOGS: Catalogs = \{ en: merged\.en! \}/);
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
  assert.match(screen, /const applied = apply\(operation, announce, \{[\s\S]*liveMix: true/);
  assert.match(screen, /if \(!applied\) return false/);
  assert.match(screen, /next\.tracks\.forEach\(x => mixOf\(x\.id, next\)\)/);
  assert.match(screen, /set_track_mute'[\s\S]*return mix\(operation\.trackId, d => setTrackMute/);
  assert.match(screen, /set_track_solo'[\s\S]*return mix\(operation\.trackId, d => setTrackSolo/);
  assert.match(component, /if \(!applyOperation\(result\.operation\)\) return/);
  assert.match(component, /if \(readOnly \|\| busy \|\| \(recording && !liveMix\)\) return/);
  assert.ok(component.indexOf('if (!applyOperation(result.operation)) return') < component.indexOf('setResult(done)'), 'a refused apply preserves the proposal and history');
  assert.match(screen, /if \(readOnly \|\| replacing \|\| historyBusy \|\| \(\(takes\.controller\.locked\(\) \|\| midiController\.locked\(\)\) && !liveMix\)\) return false/);
});
