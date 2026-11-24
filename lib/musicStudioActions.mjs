export const MUSIC_STUDIO_INPUT_LIMIT = 200;
export const MUSIC_STUDIO_ACTION_TYPES = Object.freeze([
  'set_tempo', 'set_track_mute', 'set_track_solo', 'set_view', 'select_pattern',
]);

const local = (value) => String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
const exactName = (value) => String(value ?? '').normalize('NFC').trim().toLowerCase();
const result = (kind, code, params = {}) => Object.freeze({ kind, code, messageKey: `studioAssistant.${code}`, params: Object.freeze(params) });
const answer = (code, params = {}, extra = {}) => Object.freeze({ ...result('answer', code, params), ...extra });
const error = (code, params = {}) => result('error', code, params);
const blocked = (code, params = {}) => result('blocked', code, params);

function revision(document) {
  return Object.freeze({ id: String(document.id ?? ''), updatedAt: Number(document.updatedAt) || 0, document });
}

function proposal(document, operation, code, params) {
  return Object.freeze({ ...result('proposal', code, params), operation: Object.freeze(operation), revision: revision(document) });
}

function exactTrack(document, spec) {
  if (spec.kind === 'index') {
    const track = document.tracks?.[spec.value - 1];
    return track ? { track } : { code: 'track_not_found', params: { track: spec.value } };
  }
  const wanted = exactName(spec.value);
  const matches = (document.tracks ?? []).filter((track) => exactName(track.name) === wanted);
  if (!matches.length) return { code: 'track_not_found', params: { track: spec.value } };
  if (matches.length > 1) return { code: 'track_ambiguous', params: { track: spec.value } };
  return { track: matches[0] };
}

function trackSpec(text) {
  let match = text.match(/^track\s+(\d+)$/u);
  if (match) return { kind: 'index', value: Number(match[1]) };
  match = text.match(/^named\s+(.+)$/u);
  return match ? { kind: 'name', value: match[1].trim() } : null;
}

function editabilityCode(editability, liveMix) {
  if (editability?.readOnly) return 'not_editable_now';
  if (editability?.replacing || editability?.busy) return 'not_editable_now';
  if (editability?.recording && !liveMix) return 'not_editable_now';
  return null;
}

const forbiddenIntent = /\b(generate|regenerate|stem|stems|split|extend|replace|upload|export|publish|share|plugin|code|script|execute|synthesi[sz]e)\b/u;

export function musicStudioProposalCurrent(proposalResult, document) {
  return proposalResult?.kind === 'proposal'
    && proposalResult.revision.document === document
    && proposalResult.revision.id === String(document?.id ?? '')
    && (!('trackId' in proposalResult.operation) || document?.tracks?.some((track) => track.id === proposalResult.operation.trackId));
}

export function planMusicStudioAction({ input, document, capabilities = {}, editability = {} }) {
  if (!capabilities.studioChat) return blocked('studio_disabled');
  const raw = String(input ?? '');
  if ([...raw].length > MUSIC_STUDIO_INPUT_LIMIT) return error('too_long', { limit: MUSIC_STUDIO_INPUT_LIMIT });
  const command = local(raw);
  if (!command) return error('empty');
  if (/[;\n\r]/u.test(raw) || /\band\s+then\b/u.test(command)) return error('one_action');
  if (!document || !Array.isArray(document.tracks)) return error('project_unavailable');

  if (/^(help|what can you do|supported actions|show help)$/u.test(command)) return answer('help');
  if (/^(what(?:'s| is) (?:the )?(?:current )?tempo|current tempo|tempo\?)$/u.test(command)) {
    return answer('tempo', { bpm: document.tempo?.bpm ?? 0 });
  }
  if (/^(what(?:'s| is) (?:the )?(?:current )?(?:view|pattern)|current view|current pattern)$/u.test(command)) {
    return answer('view', { view: document.view, pattern: document.currentPattern });
  }
  if (/^(list|show|describe)(?: the)? tracks$/u.test(command)) {
    return answer('tracks', { count: document.tracks.length }, { tracks: Object.freeze(document.tracks.slice(0, 16).map((track, index) => Object.freeze({ index: index + 1, name: track.name, mute: Boolean(track.mute), solo: Boolean(track.solo) }))) });
  }

  let match = command.match(/^set tempo (\d+)$/u);
  if (match) {
    const bpm = Number(match[1]);
    if (!Number.isSafeInteger(bpm) || bpm < 40 || bpm > 240) return error('tempo_range', { min: 40, max: 240 });
    if (document.tempo?.bpm === bpm) return answer('already', { value: bpm });
    const locked = editabilityCode(editability, false);
    return locked ? error(locked) : proposal(document, { type: 'set_tempo', bpm }, 'preview_tempo', { bpm });
  }

  const trackCommand = exactName(raw);
  match = trackCommand.match(/^(mute|unmute|solo|unsolo)\s+(track\s+\d+|named\s+.+)$/u);
  if (match) {
    const spec = trackSpec(match[2].replace(/^(track|named)\s+/u, '$1 '));
    if (!spec) return error('track_format');
    const resolved = exactTrack(document, spec);
    if (!resolved.track) return error(resolved.code, resolved.params);
    const solo = match[1].includes('solo');
    const value = !match[1].startsWith('un');
    if (Boolean(resolved.track[solo ? 'solo' : 'mute']) === value) return answer('already', { value: resolved.track.name });
    const locked = editabilityCode(editability, true);
    if (locked) return error(locked);
    return proposal(document, { type: solo ? 'set_track_solo' : 'set_track_mute', trackId: resolved.track.id, value },
      solo ? 'preview_solo' : 'preview_mute', { track: resolved.track.name, value: value ? 'on' : 'off' });
  }

  match = command.match(/^switch to (song|pattern)(?: view)?$/u);
  if (match) {
    const view = match[1];
    if (document.view === view) return answer('already', { value: view });
    const locked = editabilityCode(editability, false);
    return locked ? error(locked) : proposal(document, { type: 'set_view', view }, 'preview_view', { view });
  }

  match = command.match(/^select pattern ([a-d])$/u);
  if (match) {
    const pattern = match[1].toUpperCase();
    if (document.currentPattern === pattern) return answer('already', { value: pattern });
    const locked = editabilityCode(editability, false);
    return locked ? error(locked) : proposal(document, { type: 'select_pattern', pattern }, 'preview_pattern', { pattern });
  }

  if (forbiddenIntent.test(command)) return blocked(capabilities.magicBar ? 'magic_handoff' : 'magic_locked');
  return error('unsupported');
}
