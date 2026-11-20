import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { BEAT_KEYS, BEAT_SHORTCUTS, beatModifier, shortcutKeys } from '../app/veyrnox/_lib/music/beat/beatShortcuts.mjs';
import { TYPING_NOTES } from '../app/veyrnox/_lib/music/beat/beatKeys.mjs';
import { DRUM_PADS } from '../lib/musicInstruments.js';
const source = name => readFileSync(`app/veyrnox/_components/music/beat/${name}.jsx`, 'utf8');
test('sheet renders the shared shortcut list and platform modifier', () => {
  assert.match(source('BeatShortcutSheet'), /BEAT_SHORTCUTS\.filter/);
  assert.equal(beatModifier({ platform: 'MacIntel' }), '⌘');
  assert.equal(beatModifier({ userAgentData: { platform: 'Windows' } }), 'Ctrl');
  assert.equal(shortcutKeys(BEAT_SHORTCUTS.find(row => row.id === 'undo'), { platform: 'MacIntel' }), '⌘+Z');
  assert.deepEqual(BEAT_SHORTCUTS.find(row => row.id === 'ripple').handled, ['r']);
  assert.equal(BEAT_SHORTCUTS.find(row => row.id === 'ripple').context, 'global');
  assert.ok(![...DRUM_PADS.map(p => p.key), ...Object.keys(TYPING_NOTES)].includes('r'));
  assert.equal(new Set(BEAT_SHORTCUTS.map(row => row.id)).size, BEAT_SHORTCUTS.length);
  assert.deepEqual(BEAT_SHORTCUTS.find(row => row.id === 'notes').handled, Object.keys(TYPING_NOTES));
  assert.deepEqual(BEAT_SHORTCUTS.find(row => row.id === 'pads').handled, DRUM_PADS.map(p => p.key));
  assert.ok(!BEAT_SHORTCUTS.some(row => /Mod\+[LK]|^C$/.test(row.keys)));
});
test('every explicit surface key has a sheet entry; documented keys remain in handlers', () => {
  const contexts = { grid: 'BeatStepGrid', regions: 'BeatRegion', ruler: 'BeatRuler', piano: 'BeatPianoRoll', automation: 'BeatAutomationLane', takes: 'BeatTakeLanes' };
  for (const [context, file] of Object.entries(contexts)) {
    const text = source(file);
    const handled = new Set(BEAT_SHORTCUTS.filter(row => row.context === context).flatMap(row => row.handled));
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX), literals = [];
    function scan(node) {
      if (ts.isBinaryExpression(node) && /^(?:event|e)\.key(?:\.toLowerCase\(\))?$/.test(node.left.getText(tree)) && ts.isStringLiteral(node.right)) literals.push(node.right.text);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'includes' && /^(?:event|e)\.key$/.test(node.arguments[0]?.getText(tree) || '') && ts.isArrayLiteralExpression(node.expression.expression)) {
        literals.push(...node.expression.expression.elements.filter(ts.isStringLiteral).map(item => item.text));
      }
      ts.forEachChild(node, scan);
    }
    scan(tree);
    for (const key of literals) assert.ok(handled.has(key), `${file}: undocumented ${key}`);
    const shared = [...text.matchAll(/BEAT_KEYS\.(ruler|takes)/g)].flatMap(match => BEAT_KEYS[match[1]]);
    const native = context === 'grid' ? ['Enter', ' ', ...BEAT_KEYS.arrows] : [];
    for (const key of handled) assert.ok(literals.includes(key) || shared.includes(key) || native.includes(key), `${file}: stale ${key}`);
  }
  for (const name of ['help', 'play', 'undo', 'redo', 'ripple']) assert.match(source('BeatEditor'), new RegExp(`BEAT_KEYS\\.${name}`));
});

test('library suggestions select nearby categories and keep at least two recovery choices', async () => {
  const { suggestBeatCategories } = await import('../app/veyrnox/_lib/music/beat/beatLibrarySuggestions.mjs');
  const sounds = [{ category: 'Bass', name: 'Warm bass' }, { category: 'Keys', name: 'Electric piano' }, { category: 'Synth', name: 'Bright synth' }];
  assert.equal(suggestBeatCategories('piano', sounds)[0], 'Keys');
  assert.equal(suggestBeatCategories('bass', sounds)[0], 'Bass');
  assert.equal(suggestBeatCategories('unmatched', sounds).length, 2);
});

test('responsive action groups hide duplicates while new equivalents remain available at both widths', async () => {
  const { harness, elements, button } = await import('./helpers/musicBeatComponentHarness.mjs');
  const ops = await import('../app/veyrnox/_lib/music/beat/beatOps.mjs');
  const h = harness();
  const RegionActions = h.load('BeatRegionActions', { '../../../_lib/music/beat/beatOps.mjs': ops }).default;
  const region = { id: 'r1', start: 0, length: 3840 }, track = { id: 't1' };
  const tree = h.render(() => RegionActions({ region, track, tracks: [track], edit() {} }));
  function visible(node, width, hidden = false) {
    if (Array.isArray(node)) return node.flatMap(child => visible(child, width, hidden));
    if (!node?.props) return [];
    const classes = (node.props.className || '').split(/\s+/);
    hidden ||= classes.includes('lg:hidden') && width >= 1024;
    return [...(hidden ? [] : [node]), ...visible(node.props.children, width, hidden)];
  }
  for (const width of [375, 1280]) {
    const shown = visible(tree, width);
    for (const text of ['Previous track', 'Next track', 'Extend start']) assert.ok(shown.includes(button(tree, text)), `${text} at ${width}`);
    assert.equal(shown.some(n => n.props['aria-label'] === 'Region actions'), width < 1024);
    for (const text of ['Split at playhead', 'Duplicate', 'Delete']) assert.equal(button(tree, text), undefined, `${text} belongs to the shared selected-region group`);
  }
  assert.equal([...elements(tree)].filter(n => n.props['aria-label'] === 'Region actions').length, 1);
  // The selected-region group is now the sole pattern/split/duplicate/delete toolbar.
  assert.match(source('BeatArrangement'), /className="flex flex-wrap gap-2" role="group" aria-label=\{t\('app.music.beat.ui.selected.region'\)\}/);
  assert.match(source('BeatPianoRoll'), /className="flex flex-wrap gap-1 p-2 md:hidden" aria-label=\{t\('app.music.beat.ui.selected.note.actions'\)\}/);
  for (const key of ['cursorTick', 'cursorPitch', 'cursorToggle', 'octaveDown', 'octaveUp']) {
    const text = source('BeatPianoRoll'), start = text.indexOf('<div className="flex flex-wrap gap-2 p-2">'), end = text.indexOf('<div dir="ltr" ref={scroller}');
    assert.ok(text.slice(start, end).includes(`app.music.beat.control.${key}`));
    assert.doesNotMatch(text.slice(start, end), /(?:md|lg):hidden/);
  }
  const equivalents = {
    regionMove: ['app.music.beat.shortcut.regionEdit', 'app.music.beat.control.previousTrack', 'app.music.beat.control.nextTrack'],
    regionResize: ['app.music.beat.shortcut.regionEdit'],
    regionTrim: ['app.music.beat.shortcut.regionEdit', 'app.music.beat.control.extendStart'],
    pianoResize: ['app.music.beat.ui.piano.roll.note.grid'],
    pianoDelete: ['app.music.beat.control.cursorToggle'],
    pianoVelocity: ['app.music.beat.ui.velocity.lane'],
  };
  for (const [id, keys] of Object.entries(equivalents)) assert.deepEqual(BEAT_SHORTCUTS.find(row => row.id === id).controlKeys, keys);
  assert.match(source('BeatShortcutSheet'), /row\.controlKeys\.map/);
});
