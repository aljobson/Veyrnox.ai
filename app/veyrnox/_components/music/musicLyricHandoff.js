export const MUSIC_LYRIC_HANDOFF_KEY = 'veyrnox.music.lyric-handoff.v1';
export const MUSIC_LYRIC_START = 'BEGIN REVISED LYRICS';
export const MUSIC_LYRIC_END = 'END REVISED LYRICS';
export const MUSIC_REPLACEMENT_START = 'BEGIN REPLACEMENT LINES';
export const MUSIC_REPLACEMENT_END = 'END REPLACEMENT LINES';

const MAX_LYRICS = 3000;
const MAX_REQUEST = 280;
const MAX_AGE_MS = 60 * 60 * 1000;
const USER_RE = /^[A-Za-z0-9_-]{1,128}$/;
import { isUuid } from '../../../../lib/validate.js';

export function parseMusicLyricAssistantReply(value) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  const start = text.indexOf(`${MUSIC_LYRIC_START}\n`);
  if (start < 0) return '';
  const bodyStart = start + MUSIC_LYRIC_START.length + 1;
  const end = text.indexOf(`\n${MUSIC_LYRIC_END}`, bodyStart);
  if (end < 0) return '';
  const lyrics = text.slice(bodyStart, end).trim();
  return lyrics && lyrics.length <= MAX_LYRICS ? lyrics : '';
}

export function parseMusicLyricReplacementReply(value) {
  const text = String(value || '').replace(/\r\n?/g, '\n');
  const start = text.indexOf(`${MUSIC_REPLACEMENT_START}\n`);
  if (start < 0) return '';
  const bodyStart = start + MUSIC_REPLACEMENT_START.length + 1;
  const end = text.indexOf(`\n${MUSIC_REPLACEMENT_END}`, bodyStart);
  if (end < 0) return '';
  const replacement = text.slice(bodyStart, end).trim();
  return replacement && replacement.length <= MAX_LYRICS ? replacement : '';
}

export function replaceMusicLyricSelection(source, start, end, replacement, maxLength = MAX_LYRICS) {
  const text = String(source || '');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) return '';
  const replacementText = String(replacement || '');
  if (!replacementText || !Number.isInteger(maxLength) || maxLength < 1) return '';
  const next = `${text.slice(0, start)}${replacementText}${text.slice(end)}`;
  return next.length <= maxLength ? next : '';
}

function validContext(value, userId, now) {
  return value && value.v === 1
    && value.user_id === userId && USER_RE.test(userId)
    && Number.isInteger(value.source_revision) && value.source_revision >= 0
    && typeof value.source_lyrics === 'string' && value.source_lyrics.length <= MAX_LYRICS
    && typeof value.request === 'string' && value.request.length > 0 && value.request.length <= MAX_REQUEST
    && (value.mode === undefined || value.mode === 'selection')
    && (value.mode !== 'selection' || (Number.isInteger(value.selection_start) && Number.isInteger(value.selection_end)
      && value.selection_start >= 0 && value.selection_end > value.selection_start && value.selection_end <= value.source_lyrics.length))
    && (value.profile_id === undefined || (typeof value.profile_id === 'string' && isUuid(value.profile_id)))
    && Number.isFinite(value.created_at) && value.created_at <= now && now - value.created_at <= MAX_AGE_MS
    && (value.proposal === undefined || (typeof value.proposal === 'string' && value.proposal.length > 0 && value.proposal.length <= MAX_LYRICS));
}

export function readMusicLyricHandoff(storage, userId, now = Date.now()) {
  if (!storage || typeof userId !== 'string') return null;
  try {
    const value = JSON.parse(storage.getItem(MUSIC_LYRIC_HANDOFF_KEY) || 'null');
    return validContext(value, userId, now) ? value : null;
  } catch {
    return null;
  }
}

export function writeMusicLyricHandoff(storage, { userId, sourceRevision, sourceLyrics, request, profileId = '', selection = null }, now = Date.now()) {
  const value = {
    v: 1,
    user_id: userId,
    source_revision: sourceRevision,
    source_lyrics: String(sourceLyrics || ''),
    request: String(request || '').trim(),
    created_at: now,
    ...(profileId ? { profile_id: profileId } : {}),
    ...(selection ? { mode: 'selection', selection_start: selection.start, selection_end: selection.end } : {}),
  };
  if (!validContext(value, userId, now)) return false;
  try {
    storage.setItem(MUSIC_LYRIC_HANDOFF_KEY, JSON.stringify(value));
    return Boolean(readMusicLyricHandoff(storage, userId, now));
  } catch {
    return false;
  }
}

export function writeMusicLyricProposal(storage, userId, reply, now = Date.now()) {
  const context = readMusicLyricHandoff(storage, userId, now);
  const proposal = context?.mode === 'selection' ? parseMusicLyricReplacementReply(reply) : parseMusicLyricAssistantReply(reply);
  if (!context || !proposal) return false;
  try {
    storage.setItem(MUSIC_LYRIC_HANDOFF_KEY, JSON.stringify({ ...context, proposal }));
    return readMusicLyricHandoff(storage, userId, now)?.proposal === proposal;
  } catch {
    return false;
  }
}

export function clearMusicLyricHandoff(storage) {
  try { storage?.removeItem(MUSIC_LYRIC_HANDOFF_KEY); } catch {}
}
