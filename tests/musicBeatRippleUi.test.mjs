import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, find, button, elements } from './helpers/musicBeatComponentHarness.mjs';
import * as documentModule from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import * as time from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import * as midi from '../app/veyrnox/_lib/music/beat/beatMidiOps.mjs';
import * as rippleOps from '../app/veyrnox/_lib/music/beat/beatRipple.mjs';
import * as guard from '../app/veyrnox/_lib/music/beat/beatRippleGuard.mjs';
import * as search from '../app/veyrnox/_lib/music/beat/beatClipSearch.mjs';
import * as playbackAudio from '../app/veyrnox/_lib/music/beat/beatPlaybackAudio.mjs';
import * as styles from '../app/veyrnox/_components/music/beat/beatStyles.js';
import { BEAT_KEYS, BEAT_SHORTCUTS } from '../app/veyrnox/_lib/music/beat/beatShortcuts.mjs';
import { BEAT_ACTIONS } from '../app/veyrnox/_lib/music/beat/beatActionLabels.mjs';
import { beatText } from '../app/veyrnox/_lib/music/beat/beatDisplay.mjs';
import { createHistory, record, undo, redo } from '../app/veyrnox/_lib/music/beat/beatHistory.mjs';
import { rippleFixture, takeRippleFixture } from './musicBeatRippleFixtures.mjs';
const base = '../../../_lib/music/beat/';
const childNames = ['BeatAutomationLane', 'BeatRuler', 'BeatTrackHeader', 'BeatRegion', 'BeatRegionInspector', 'BeatLibrary', 'BeatRegionActions', 'BeatClipSearch'];
function arrangement(doc = rippleFixture()) {
  const h = harness(), children = Object.fromEntries(childNames.map(name => [name, () => null]));
  let history = createHistory(doc), locator = 0, ripple = false, selection, editTrack;
  const messages = [], edits = [];
  const Arrangement = h.load('BeatArrangement', {
    ...Object.fromEntries(Object.entries(children).map(([name, Component]) => [`./${name}`, { __esModule: true, default: Component }])),
    'next/dynamic': { __esModule: true, default: () => () => null }, './useRegionDrag': { __esModule: true, default: () => ({}) },
    './beatStyles': styles, [base + 'beatDocument.mjs']: documentModule, [base + 'beatTime.mjs']: time,
    [base + 'beatMidiOps.mjs']: midi, [base + 'beatOps.mjs']: ops,
    [base + 'beatRipple.mjs']: rippleOps, [base + 'beatRippleGuard.mjs']: guard,
    [base + 'beatAssets']: { clearBeatAssets() {}, syncAssetTempo() {} }, [base + 'beatSounds.mjs']: {},
  }).default;
  const props = () => ({ doc: history.present, locator, setLocator: value => { locator = value; }, ripple,
    setRipple: change => { ripple = change(ripple); }, playhead: -1, runId: null,
    announce: text => messages.push(text), onSelectRegion: id => { selection = id; },
    setEditTrackId: id => { editTrack = id; }, selectPattern() {},
    edit(change, options) {
      const result = ops.tryOp(history.present, change);
      if (result.refused) { messages.push(beatText(result.refused)); return null; }
      if (result.doc === history.present) return null;
      edits.push(options); history = record(history, result.doc, options); return history.past.at(-1).id;
    },
  });
  const render = () => h.render(() => Arrangement(props()));
  render();
  return { h, children, render, messages, edits,
    get history() { return history; }, get locator() { return locator; }, get selection() { return selection; }, get editTrack() { return editTrack; },
    locate(value) { locator = value; render(); },
    region(id) { return find(h.tree, n => n.type === children.BeatRegion && n.props.region.id === id); },
    select(id) { this.region(id).props.select(); render(); },
    toggle() { button(h.tree, 'Ripple edit').props.onClick(); render(); },
  };
}
test('ripple toolbar defaults off; enabled deletion shifts only its track and is one undoable step', () => {
  for (const enabled of [false, true]) {
    const a = arrangement(), before = a.history.present;
    assert.equal(button(a.h.tree, 'Ripple edit').props['aria-pressed'], false);
    a.select('r0'); if (enabled) a.toggle();
    button(a.h.tree, 'Delete region').props.onClick();
    assert.deepEqual(a.history.present.tracks[0].regions.map(r => r.start), enabled ? [0, 3840] : [3840, 7680]);
    assert.deepEqual(a.history.present.tracks[1], before.tracks[1]);
    assert.deepEqual(a.history.present.cycle, before.cycle);
    assert.equal(a.history.present.version, 4);
    assert.equal(a.history.past.length, 1);
    assert.equal(a.edits[0].label, enabled ? BEAT_ACTIONS.a59 : BEAT_ACTIONS.a7);
    const undone = undo(a.history);
    assert.deepEqual({ ...undone.present, updatedAt: before.updatedAt }, before);
    assert.deepEqual(redo(undone).present, a.history.present);
  }
});
test('focused region Delete and Backspace use the same ripple deletion path and keep focus recovery', t => {
  const previous = { document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame };
  t.after(() => Object.assign(globalThis, previous));
  let focused = 0;
  globalThis.document = { querySelectorAll: () => [], querySelector: () => ({ focus() { focused++; } }) };
  globalThis.requestAnimationFrame = fn => fn();
  for (const key of ['Delete', 'Backspace']) for (const enabled of [false, true]) {
    const a = arrangement(); if (enabled) a.toggle();
    const h = harness();
    const Region = h.load('BeatRegion', { [base + 'beatAssets.js']: { subscribeAssets() {}, assetState: () => ({}) },
      [base + 'beatTime.mjs']: time, [base + 'beatPlaybackAudio.mjs']: playbackAudio, [base + 'beatOps.mjs']: ops,
      './BeatMidiPreview': {}, './BeatAudioRegion': {},
    }).default;
    const node = h.render(() => Region(a.region('r0').props));
    find(node, n => n.props['data-region-id'] === 'r0').props.onKeyDown({ key, preventDefault() {} });
    assert.deepEqual(a.history.present.tracks[0].regions.map(r => r.start), enabled ? [0, 3840] : [3840, 7680]);
  }
  assert.equal(focused, 4);
});
test('gap uses snapped playhead; boundary inserts one bar and restores with undo/redo', () => {
  const a = arrangement();
  assert.equal(button(a.h.tree, 'Insert gap').props.disabled, true);
  a.select('r0'); a.locate(3839);
  const before = a.history.present;
  button(a.h.tree, 'Insert gap').props.onClick();
  assert.deepEqual(a.history.present.tracks[0].regions.map(r => [r.start, r.length]), [[0, 3840], [7680, 3840], [11520, 3840]]);
  assert.deepEqual(a.history.present.tracks[1], before.tracks[1]);
  assert.deepEqual(a.history.present.cycle, before.cycle);
  assert.equal(a.history.past.length, 1); assert.equal(a.edits[0].label, BEAT_ACTIONS.a60);
  assert.deepEqual({ ...undo(a.history).present, updatedAt: before.updatedAt }, before);
  assert.deepEqual(redo(undo(a.history)).present, a.history.present);
});
test('inside/no-later gap refusals announce guidance with byte-identical document and no history', () => {
  for (const [tick, copy] of [[240, 'Choose a clip boundary or the end of a clip'], [11520, 'Nothing to move after this point']]) {
    const a = arrangement(); a.select('r0'); a.locate(tick);
    const before = JSON.stringify(a.history);
    button(a.h.tree, 'Insert gap').props.onClick();
    assert.equal(a.messages.at(-1), copy); assert.equal(JSON.stringify(a.history), before); assert.equal(a.edits.length, 0);
  }
});
test('ripple UI refuses downstream take changes and clips entering empty groups without losing assets or history', () => {
  for (const empty of [false, true]) for (const operation of ['delete', 'insert']) {
    const a = arrangement(takeRippleFixture(empty)); a.select('before'); a.toggle(); a.locate(0);
    const before = JSON.stringify(a.history);
    button(a.h.tree, operation === 'delete' ? 'Delete region' : 'Insert gap').props.onClick();
    assert.equal(a.messages.at(-1), 'Ripple would change a take group. Choose a different clip or position.');
    assert.equal(JSON.stringify(a.history), before); assert.equal(a.edits.length, 0);
  }
});
test('all ripple refusal codes resolve to translated copy and invalid helper results never expose raw codes', async () => {
  for (const locale of ['en', 'es', 'ar']) {
    const messages = (await import(`../lib/i18n/messages/app/${locale}.mjs`)).default;
    for (const code of ['invalid_ripple', 'invalid_ticks', 'region_not_found', 'track_not_found', 'ripple_inside_region', 'ripple_nothing_to_move', 'ripple_take_group']) {
      const text = beatText(code, key => messages[key]); assert.ok(text); assert.notEqual(text, code); assert.doesNotMatch(text, /app\.music/);
    }
  }
  const doc = rippleFixture(); doc.tracks[0].regions[2].start = 512 * 3840 - 3840;
  const a = arrangement(doc); a.select('r0'); a.locate(0);
  button(a.h.tree, 'Insert gap').props.onClick();
  assert.equal(a.messages.at(-1), 'Cannot ripple here. Keep clips inside the song limits and on the grid.');
  assert.equal(a.history.past.length, 0);
});
test('search empty query, live count, 20-row cap, keyboard escape and clear recovery', () => {
  const h = harness(), chosen = [];
  const Search = h.load('BeatClipSearch', { [base + 'beatClipSearch.mjs']: search, [base + 'beatTime.mjs']: time, './beatStyles': styles }).default;
  const doc = rippleFixture(); doc.tracks[0].regions = Array.from({ length: 25 }, (_, i) => ({ ...doc.tracks[0].regions[0], id: `r${i}`, start: i * 3840 }));
  const render = () => h.render(() => Search({ doc, choose: result => chosen.push(result) }));
  const query = text => { find(h.tree, n => n.props.type === 'search').props.onChange({ target: { value: text } }); render(); };
  render(); assert.equal([...elements(h.tree)].filter(n => n.type === 'li').length, 0);
  query('DRUMS'); assert.equal([...elements(h.tree)].filter(n => n.type === 'li').length, 20);
  assert.equal(find(h.tree, n => n.props.role === 'status').props.children, 'Matches: 26. Showing: 20.');
  find(h.tree, n => n.type === 'li').props.children.props.onClick(); assert.equal(chosen[0].regionId, 'r0');
  find(h.tree, n => n.props.type === 'search').props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); render();
  assert.equal(find(h.tree, n => n.props.type === 'search').props.value, '');
  query('nonexistent'); assert.ok(find(h.tree, n => typeof n.props.children === 'string' && n.props.children.includes('“nonexistent”')));
  button(h.tree, 'Clear search').props.onClick(); render(); assert.equal(find(h.tree, n => n.props.type === 'search').props.value, '');
});
test('choosing a search result selects the region and track, clamps locator and scrolls its lane', () => {
  const a = arrangement(); let scrolled = 0;
  const scroller = find(a.h.tree, n => n.props['aria-label'] === 'Arrangement timeline').props.ref;
  scroller.current = { scrollLeft: 0, querySelectorAll: () => [{ dataset: { trackLane: 't1' }, scrollIntoView() { scrolled++; } }] };
  const result = search.searchClips(a.history.present, 'drums').find(r => r.regionId === 'r2');
  find(a.h.tree, n => n.type === a.children.BeatClipSearch).props.choose(result);
  assert.equal(a.selection, 'r2'); assert.equal(a.editTrack, 't1'); assert.equal(a.locator, 7680); assert.equal(scrolled, 1);
  assert.ok(scroller.current.scrollLeft > 0);
});
test('global R handler toggles component state, ignores text input/modifiers/repeat and has shared shortcut copy', () => {
  const source = readFileSync('app/veyrnox/_components/music/beat/BeatEditor.jsx', 'utf8');
  assert.match(source, /\[ripple, setRipple\] = useState\(false\)/);
  const body = source.slice(source.indexOf('    function key(event) {'), source.indexOf('    const up ='));
  let ripple = false, prevented = 0;
  const key = new Function('keyState', 'document', 'BEAT_KEYS', 'setRipple', `${body}; return key;`)(
    { current: { doc: rippleFixture(), playback: {}, project: {}, toggleRipple: () => { ripple = !ripple; } } }, { querySelector: () => null }, BEAT_KEYS, fn => { ripple = fn(ripple); });
  const event = patch => ({ key: 'r', target: { tagName: 'DIV', closest: () => null }, preventDefault() { prevented++; }, ...patch });
  key(event()); assert.equal(ripple, true); key(event({ key: 'R' })); assert.equal(ripple, false);
  for (const patch of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { target: { tagName: 'INPUT', type: 'search', closest: () => null } }]) key(event(patch));
  assert.equal(prevented, 2); assert.equal(ripple, false);
  assert.equal(BEAT_SHORTCUTS.find(row => row.id === 'ripple').context, 'global');
});
test('search UI matches valid audio and MIDI names while drums match only their track', () => {
  let doc = takeRippleFixture();
  doc = midi.addMidiRegion(midi.addMidiTrack(doc, { engine: 'voice', id: 'bass', preset: 'sub' }, 1), 't3', 0, 1);
  doc.clips[doc.tracks[2].regions[0].clipId].name = 'Warm bass';
  assert.equal(documentModule.validateBeat(doc).ok, true);
  const h = harness();
  const Search = h.load('BeatClipSearch', { [base + 'beatClipSearch.mjs']: search, [base + 'beatTime.mjs']: time, './beatStyles': styles }).default;
  let chosen;
  const render = () => h.render(() => Search({ doc, choose: result => { chosen = result; } }));
  render();
  for (const [query, trackId] of [['CURRENT', 't2'], ['warm BASS', 't3']]) {
    find(h.tree, n => n.props.type === 'search').props.onChange({ target: { value: query } }); render();
    const rows = [...elements(h.tree)].filter(n => n.type === 'li');
    assert.equal(rows.length, 1); rows[0].props.children.props.onClick(); assert.equal(chosen.trackId, trackId);
  }
  assert.deepEqual(search.searchClips(rippleFixture(), 'A'), [], 'a drum pattern slot is not a region name');
});
