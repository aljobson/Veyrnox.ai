import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, find } from './helpers/musicBeatComponentHarness.mjs';
import { make } from './musicBeatFixtures.mjs';
import * as actions from '../lib/musicStudioActions.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import messages from '../lib/i18n/messages/app/en.mjs';
import { translator } from '../lib/i18n/translate.mjs';
import { MUSIC_STUDIO_ASSISTANT_TRANSLATIONS } from '../lib/i18n/musicStudioAssistantTranslations.mjs';

const english = translator('en', { ...messages, ...MUSIC_STUDIO_ASSISTANT_TRANSLATIONS.en });

function setup(overrides = {}) {
  const h = harness(), calls = [];
  let doc = make(), props;
  const Component = h.load('BeatStudioAssistant', {
    '../../../../../lib/musicStudioActions.mjs': actions,
    '../../../../../components/I18nProvider': { useI18n: () => ({ locale: 'en', t: english }) },
    '../../../_lib/music/beat/beatOps.mjs': ops,
    './beatStyles': { action: 'action', button: 'button', input: 'input' },
  }).default;
  const edit = (change, options) => { calls.push(options); const next = change(doc); if (next === doc) return null; doc = next; return 'history-1'; };
  const render = () => Component({ doc, magicBar: false, readOnly: false, recording: false, busy: false, edit, selectPattern(slot) { doc = ops.selectPattern(doc, slot); return true; }, announce() {}, ...overrides, ...props });
  h.render(render);
  return { h, calls, get doc() { return doc; }, setProps(next) { props = next; h.render(render); }, render };
}

const input = tree => find(tree, node => node.type === 'input');
const button = (tree, text) => find(tree, node => node.type === 'button' && node.props.children === text);
const textOf = node => Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : typeof node === 'string' ? node : '';
const editorSource = readFileSync(new URL('../app/veyrnox/_components/music/beat/BeatEditor.jsx', import.meta.url), 'utf8');
const projectSource = readFileSync(new URL('../app/veyrnox/_components/music/beat/useBeatProject.js', import.meta.url), 'utf8');

test('Studio assistant reviews before applying and cancel never mutates', async () => {
  const world = setup();
  input(world.h.tree).props.onChange({ target: { value: 'set tempo 120' } }); world.h.render();
  find(world.h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); world.h.render();
  assert.equal(world.doc.tempo.bpm, 92);
  button(world.h.tree, 'Cancel').props.onClick(); world.h.render();
  assert.equal(world.doc.tempo.bpm, 92);
  find(world.h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); world.h.render();
  button(world.h.tree, 'Apply local edit').props.onClick(); world.h.render();
  assert.equal(world.doc.tempo.bpm, 120);
  assert.equal(world.calls.length, 1);
  const applied = find(world.h.tree, node => node.type === 'p' && textOf(node).includes('Local edit applied'));
  assert.equal(applied.props.role, undefined, 'the editor announcement is the only live edit announcement');
});

test('Studio assistant exposes only live mixer proposals during recording', () => {
  const world = setup({ recording: true });
  input(world.h.tree).props.onChange({ target: { value: 'mute track 1' } }); world.h.render();
  find(world.h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); world.h.render();
  const liveApply = button(world.h.tree, 'Apply local edit');
  assert.equal(liveApply.props['data-beat-live'], true);
  liveApply.props.onClick(); world.h.render();
  assert.equal(world.calls[0].liveMix, true);
  assert.equal(world.calls[0].trackId, 't1');
  input(world.h.tree).props.onChange({ target: { value: 'set tempo 120' } }); world.h.render();
  find(world.h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); world.h.render();
  assert.equal(button(world.h.tree, 'Apply local edit'), undefined);
});

test('Studio assistant invalidates a proposal after a same-timestamp rename', async () => {
  const world = setup();
  input(world.h.tree).props.onChange({ target: { value: 'mute track 1' } }); world.h.render();
  find(world.h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); world.h.render();
  const renamed = ops.renameTrack(world.doc, 't1', 'Renamed', world.doc.updatedAt);
  assert.equal(renamed.updatedAt, world.doc.updatedAt);
  world.setProps({ doc: renamed });
  world.h.effects(); await world.h.settle();
  assert.equal(button(world.h.tree, 'Apply local edit'), undefined);
  assert.ok([...function* walk(node) { if (Array.isArray(node)) for (const child of node) yield* walk(child); else if (node?.props) { yield node; yield* walk(node.props.children); } }(world.h.tree)].some(node => String(node.props.children).includes('beat changed')));
});

test('Studio assistant disables Apply when the beat becomes read-only and keeps Cancel available', () => {
  const world = setup();
  input(world.h.tree).props.onChange({ target: { value: 'mute track 1' } }); world.h.render();
  find(world.h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); world.h.render();
  world.setProps({ readOnly: true });
  const apply = button(world.h.tree, 'Apply local edit');
  assert.equal(apply.props.disabled, true);
  button(world.h.tree, 'Cancel').props.onClick(); world.h.render();
  assert.equal(button(world.h.tree, 'Apply local edit'), undefined);
  assert.equal(world.doc.tracks[0].mute, false);
});

test('Studio assistant localizes view values and scopes history to the beat mount', () => {
  const world = setup();
  input(world.h.tree).props.onChange({ target: { value: 'current view' } }); world.h.render();
  find(world.h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); world.h.render();
  assert.ok(find(world.h.tree, node => node.type === 'p' && textOf(node).includes('Current view: Song')));
  assert.match(editorSource, /<BeatStudioAssistant key=\{doc\.id\}/);
  assert.match(editorSource, /busy=\{Boolean\(project\.conflict \|\| project\.replacing\)\}/);
  assert.match(projectSource, /replacing: replacingState/);
  input(world.h.tree).props.onChange({ target: { value: 'list tracks' } }); world.h.render();
  find(world.h.tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); world.h.render();
  assert.ok(find(world.h.tree, node => node.type === 'p' && textOf(node).includes('1 track in this beat.')));
});
