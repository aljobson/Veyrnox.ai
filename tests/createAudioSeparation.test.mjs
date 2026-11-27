import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_CARDS, MORE_FEATURES, modelWorkspaceHref } from '../app/veyrnox/_lib/tokens.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('public audio models open their dedicated workspaces', () => {
  assert.equal(modelWorkspaceHref({ id: 'ace-step', kind: 'audio' }), '/app/music/create');
  assert.equal(modelWorkspaceHref({ id: 'suno-sounds', kind: 'audio' }), '/app/music/sounds');
  assert.equal(modelWorkspaceHref({ id: 'qwen3-tts', kind: 'audio' }), '/app/text-to-speech');
  assert.equal(modelWorkspaceHref({ id: 'qwen3-tts', modality: 'text-to-audio' }), '/app/text-to-speech');
  assert.equal(modelWorkspaceHref({ id: 'elevenlabs-dialogue', kind: 'audio' }), '/app/dialogue');
  assert.equal(modelWorkspaceHref({ id: 'unknown-audio', kind: 'audio' }), '/app/audio');
  assert.equal(modelWorkspaceHref({ id: 'wan-2.5-kie', kind: 'video' }), '/app/create?model=wan-2.5-kie');
});

test('landing and footer present Music, Sound Effects and Text to Speech outside Create', () => {
  assert.equal(FEATURE_CARDS.find(({ key }) => key === 'ace-step')?.href, '/app/music/create');
  const tools = MORE_FEATURES.find(({ group }) => group === 'Tools')?.items ?? [];
  assert.deepEqual(
    tools.filter(({ label }) => ['Music', 'Sound Effects', 'Text to Speech'].includes(label)).map(({ label, href }) => [label, href]),
    [['Music', '/app/music/create'], ['Sound Effects', '/app/music/sounds'], ['Text to Speech', '/app/text-to-speech']],
  );
});

test('generic Create entry points contain image and video, not audio', () => {
  const priceSlip = read('app/veyrnox/_components/PriceSlip.js');
  const createGoals = read('app/veyrnox/_lib/starterModels.js');
  const firstGoalCard = read('app/veyrnox/_components/FirstGoalCard.js');
  const mobileCreate = read('apps/mobile/src/app/(app)/(tabs)/create.tsx');
  const mobileTemplates = read('apps/mobile/src/app/(app)/create/presets.tsx');
  const mobileHome = read('apps/mobile/src/app/(app)/(tabs)/index.tsx');
  assert.match(priceSlip, /m\.kind === 'image' \|\| m\.kind === 'video'/);
  assert.match(priceSlip, /\['video', 'image'\]/);
  assert.doesNotMatch(createGoals.match(/CREATE_GOALS = \[[\s\S]*?\];/)?.[0] ?? '', /audio|all/);
  assert.match(firstGoalCard, /id !== 'audio'/);
  assert.doesNotMatch(mobileCreate.match(/const MAKE:[\s\S]*?\];/)?.[0] ?? '', /audio/);
  assert.doesNotMatch(mobileCreate, /params: \{ kind: 'audio' \}/);
  assert.doesNotMatch(mobileTemplates.match(/const KINDS:[\s\S]*?;/)?.[0] ?? '', /audio/);
  assert.match(mobileHome, /presetKind\(p\) === 'audio'\)[\s\S]*?router\.push\('\/audio'\)/);
});

test('the Create brief keeps files, aspect, count, dictation, prompt help and templates', () => {
  const create = read('app/veyrnox/app/create/page.js');
  assert.match(create, /<SourcePickers/);
  assert.match(create, /assistantTarget="create\.aspect"/);
  assert.match(create, /assistantTarget="create\.count"/);
  assert.match(create, /<DictateButton/);
  assert.match(create, /<EnhanceButton/);
  assert.match(create, /data-testid="create-open-templates"/);
  assert.match(create, /skill=prompt-writer/);
  assert.match(create, /skill=fix-my-prompt/);
});

test('search, shelf and model details use workspace-aware model links', () => {
  for (const path of [
    'app/veyrnox/_components/SiteSearch.js',
    'app/veyrnox/_sections/showcase.js',
    'app/veyrnox/models/[id]/page.js',
  ]) assert.match(read(path), /modelWorkspaceHref/);
});
