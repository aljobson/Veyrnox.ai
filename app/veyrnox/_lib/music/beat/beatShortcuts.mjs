import { beatEnglish } from './beatDisplay.mjs';
import { DRUM_PADS } from '../../../../../lib/musicInstruments.js';
import { TYPING_NOTES } from './beatKeys.mjs';
export const BEAT_KEYS = Object.freeze({ help: '?', undo: 'z', redo: 'y', play: 'Space', ripple: 'r',
  remove: Object.freeze(['Delete', 'Backspace']), arrows: Object.freeze(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']),
  ruler: Object.freeze(['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']),
  takes: Object.freeze(['ArrowLeft', 'ArrowRight', 'Enter', 'Escape']),
});
// keys are display notation; handled is the actual KeyboardEvent key (or code for Space).
// Responsive toolbars are supplemental; these equivalents remain visible at every width.
const controls = {
  regionMove: ['app.music.beat.shortcut.regionEdit', 'app.music.beat.control.previousTrack', 'app.music.beat.control.nextTrack'],
  regionResize: ['app.music.beat.shortcut.regionEdit'],
  regionTrim: ['app.music.beat.shortcut.regionEdit', 'app.music.beat.control.extendStart'],
  pianoMove: ['app.music.beat.ui.piano.roll.note.grid', 'app.music.beat.control.cursorTick', 'app.music.beat.control.cursorPitch', 'app.music.beat.control.octaveDown', 'app.music.beat.control.octaveUp'],
  pianoResize: ['app.music.beat.ui.piano.roll.note.grid'],
  pianoDelete: ['app.music.beat.control.cursorToggle'],
  pianoVelocity: ['app.music.beat.ui.velocity.lane'],
};
const row = (context, id, keys, handled) => Object.freeze({ id, context, keys, handled: Object.freeze(handled), labelKey: `app.music.beat.shortcut.${id}`,
  controlKeys: Object.freeze(controls[id] || [`app.music.beat.shortcut.${id}`]) });
export const BEAT_SHORTCUTS = Object.freeze([
  row('global', 'help', '? (Shift+/)', ['?']),
  row('global', 'play', 'Space', ['Space']),
  row('global', 'ripple', 'R', ['r']),
  row('global', 'undo', 'Mod+Z', ['z']),
  row('global', 'redo', 'Mod+Shift+Z / Mod+Y', ['z', 'y']),
  row('grid', 'gridMove', '← ↑ → ↓', BEAT_KEYS.arrows),
  row('grid', 'gridToggle', 'Enter / Space', ['Enter', ' ']),
  row('grid', 'gridVelocity', '+ / = / −', ['+', '=', '-']),
  row('regions', 'regionMove', '← → / ↑ ↓', BEAT_KEYS.arrows),
  row('regions', 'regionResize', 'Shift+← / Shift+→', ['ArrowLeft', 'ArrowRight']),
  row('regions', 'regionTrim', '[ / ]', ['[', ']']),
  row('regions', 'regionDuplicate', 'Mod+D', ['d']),
  row('regions', 'regionSplit', 'Mod+E', ['e']),
  row('regions', 'regionDelete', 'Delete / Backspace', BEAT_KEYS.remove),
  row('regions', 'regionEdit', 'Enter', ['Enter']),
  row('ruler', 'rulerMove', '← → / PageUp / PageDown / Home / End', BEAT_KEYS.ruler),
  row('ruler', 'rulerCancel', 'Escape', ['Escape']),
  row('piano', 'pianoSelectAll', 'Mod+A', ['a']),
  row('piano', 'pianoMove', '← ↑ → ↓ / Alt+↑ / Alt+↓', BEAT_KEYS.arrows),
  row('piano', 'pianoResize', 'Shift+← / Shift+→', ['ArrowLeft', 'ArrowRight']),
  row('piano', 'pianoToggle', 'Enter / Space', ['Enter', ' ']),
  row('piano', 'pianoDelete', 'Delete / Backspace', BEAT_KEYS.remove),
  row('piano', 'pianoVelocity', '+ / = / −', ['+', '=', '-']),
  row('automation', 'automationMove', '← ↑ → ↓ / Shift+↑ / Shift+↓', BEAT_KEYS.arrows),
  row('automation', 'automationDelete', 'Delete / Backspace', BEAT_KEYS.remove),
  row('takes', 'takeMove', '← → / Shift+← / Shift+→', ['ArrowLeft', 'ArrowRight']),
  row('takes', 'takeAssign', 'Enter', ['Enter']),
  row('takes', 'takeClear', 'Escape', ['Escape']),
  row('typing', 'pads', DRUM_PADS.map(p => p.key.toUpperCase()).join(' '), DRUM_PADS.map(p => p.key)),
  row('typing', 'notes', Object.keys(TYPING_NOTES).join(' ').toUpperCase(), Object.keys(TYPING_NOTES)),
  row('typing', 'octave', 'Z / X', ['z', 'x']),
  row('typing', 'velocity', 'C / V', ['c', 'v']),
]);
export function beatModifier(navigator = {}) {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgentData?.platform || navigator.platform || '') ? '⌘' : 'Ctrl';
}
export const shortcutKeys = (shortcut, navigator, t = beatEnglish) => shortcut.keys.replaceAll('Mod', beatModifier(navigator))
  .replace(/\b(?:Space|Shift|Enter|Delete|Backspace|PageUp|PageDown|Home|End|Escape|Alt)\b/g, key => t(`app.music.beat.key.${key}`));
