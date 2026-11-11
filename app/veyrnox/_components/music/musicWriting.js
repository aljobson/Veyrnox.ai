import { MUSIC_LYRIC_END, MUSIC_LYRIC_START, MUSIC_REPLACEMENT_END, MUSIC_REPLACEMENT_START } from './musicLyricHandoff.js';

export const MUSIC_PROMPT_SUGGESTIONS = Object.freeze([
  'A patient instrumental sunrise with felt piano, soft tape hiss and restrained drums',
  'A restless night-train rhythm with muted bass, brushed percussion and distant brass',
  'A bright coastal pulse with hand percussion, clean guitar and weightless synth layers',
  'A slow cinematic build from sparse strings into warm drums and a hopeful final lift',
]);

export const MUSIC_STRUCTURE_LABELS = Object.freeze([
  '[Intro]',
  '[Verse]',
  '[Pre-Chorus]',
  '[Chorus]',
  '[Bridge]',
  '[Instrumental]',
  '[Outro]',
]);

export const MUSIC_STYLE_DETAILS = Object.freeze([
  'wide stereo space with a close, intimate centre',
  'a restrained opening that grows into a clear final lift',
  'organic transients, gentle saturation and an uncluttered low end',
  'short room ambience with one memorable instrumental motif',
]);

export const MUSIC_LYRIC_ASSISTANT_REQUEST_MAX = 280;
export const MUSIC_LYRIC_ASSISTANT_PROMPT_MAX = 4000;

const RHYME_FAMILIES = Object.freeze([
  Object.freeze(['light', 'night', 'sight', 'height', 'bright']),
  Object.freeze(['sea', 'free', 'key', 'me', 'memory']),
  Object.freeze(['time', 'rhyme', 'climb', 'chime']),
  Object.freeze(['heart', 'start', 'art', 'apart']),
  Object.freeze(['home', 'roam', 'chrome', 'known']),
  Object.freeze(['fire', 'higher', 'choir', 'wire']),
  Object.freeze(['blue', 'through', 'new', 'view']),
]);

export function nextMusicPrompt(current = '') {
  const index = MUSIC_PROMPT_SUGGESTIONS.indexOf(String(current).trim());
  return MUSIC_PROMPT_SUGGESTIONS[(index + 1) % MUSIC_PROMPT_SUGGESTIONS.length];
}

export function insertMusicStructureLabel(value, label, maxLength = 3000) {
  if (!MUSIC_STRUCTURE_LABELS.includes(label)) return String(value || '');
  const current = String(value || '');
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  const next = `${current}${separator}${label}\n`;
  return next.length <= maxLength ? next : current;
}

export function augmentMusicStyle(value, maxLength = 500) {
  const current = String(value || '').trim();
  const detail = MUSIC_STYLE_DETAILS.find((item) => !current.toLowerCase().includes(item.toLowerCase()));
  if (!detail) return current;
  const next = current ? `${current}; ${detail}` : detail;
  return next.length <= maxLength ? next : current;
}

export function musicWritingReferences(value, selectionStart, selectionEnd) {
  const text = String(value || '');
  const start = Math.max(0, Math.min(text.length, Number(selectionStart) || 0));
  const end = Math.max(start, Math.min(text.length, Number(selectionEnd) || start));
  const selected = text.slice(start, end).trim();
  const context = selected || text.slice(0, start);
  const words = context.toLowerCase().match(/[\p{L}\p{N}'-]+/gu) || [];
  const anchor = words.at(-1)?.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || '';
  if (!anchor) return { anchor: '', rhymes: [], lineStarters: [] };
  const lookupAnchor = anchor.endsWith('s') ? anchor.slice(0, -1) : anchor;
  const family = RHYME_FAMILIES.find((items) => items.includes(lookupAnchor)) || [];
  const rhymes = family.filter((item) => item !== lookupAnchor).slice(0, 4);
  return {
    anchor,
    rhymes,
    lineStarters: [
      `Show “${anchor}” through a concrete image instead of naming the feeling.`,
      `Repeat “${anchor}” with one changed detail to create a hook.`,
      `Answer the line with a contrasting place, time, or point of view.`,
    ],
  };
}

export function buildMusicLyricAssistantPrompt({ lyrics = '', request = '' } = {}) {
  const editingRequest = String(request).replace(/\r\n?/g, '\n').trim().slice(0, MUSIC_LYRIC_ASSISTANT_REQUEST_MAX);
  if (!editingRequest) return '';
  const draft = String(lyrics).replace(/\r\n?/g, '\n').trim().slice(0, 3000);
  const prompt = [
    'Help me co-write original song lyrics. I wrote or own any draft included below.',
    '',
    'Editing request:',
    editingRequest,
    '',
    'Rules:',
    '- Follow the request while preserving wording and structure that I did not ask to change.',
    '- If no draft is provided, create a fresh original draft from the request.',
    '- Do not imitate a living artist or reproduce lyrics that are not included below; offer an original alternative instead.',
    `- Return only the revised lyrics between the exact lines “${MUSIC_LYRIC_START}” and “${MUSIC_LYRIC_END}”.`,
    '- Do not put commentary, notes or a code fence inside those lines.',
    '',
    'BEGIN MY DRAFT',
    draft || '(No draft yet.)',
    'END MY DRAFT',
    '',
    'Required response shape:',
    MUSIC_LYRIC_START,
    '[revised lyrics only]',
    MUSIC_LYRIC_END,
  ].join('\n');
  return prompt.slice(0, MUSIC_LYRIC_ASSISTANT_PROMPT_MAX);
}

export function buildMusicLyricSelectionPrompt({ lyrics = '', selectionStart, selectionEnd, request = '' } = {}) {
  const draft = String(lyrics).replace(/\r\n?/g, '\n').slice(0, 3000);
  if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)) return '';
  const start = Math.max(0, Math.min(draft.length, selectionStart));
  const end = Math.max(start, Math.min(draft.length, selectionEnd));
  const selected = draft.slice(start, end);
  const editingRequest = String(request).replace(/\r\n?/g, '\n').trim().slice(0, MUSIC_LYRIC_ASSISTANT_REQUEST_MAX);
  if (!selected.trim() || !editingRequest) return '';
  const before = [
    'Replace only the selected lines in lyrics I wrote or own.',
    '',
    'Editing request:', editingRequest,
    '',
    'Rules:',
    '- Preserve the surrounding lyrics exactly; return only replacement text for the selected range.',
    '- Do not imitate a living artist or reproduce lyrics not included below.',
    `- Put the replacement only between “${MUSIC_REPLACEMENT_START}” and “${MUSIC_REPLACEMENT_END}”.`,
    '',
    'SELECTED RANGE', selected, 'END SELECTED RANGE',
  ].join('\n');
  const after = ['', 'Required response shape:', MUSIC_REPLACEMENT_START, '[replacement lines only]', MUSIC_REPLACEMENT_END].join('\n');
  const contextLabelLength = '\n\nDRAFT CONTEXT\n\nEND DRAFT CONTEXT\n'.length;
  const contextBudget = Math.max(0, MUSIC_LYRIC_ASSISTANT_PROMPT_MAX - before.length - after.length - contextLabelLength);
  const context = draft.length <= contextBudget
    ? draft
    : `${draft.slice(0, Math.floor(contextBudget / 2))}\n[…context shortened…]\n${draft.slice(-(Math.ceil(contextBudget / 2) - 23))}`;
  return `${before}\n\nDRAFT CONTEXT\n${context}\nEND DRAFT CONTEXT\n${after}`;
}
