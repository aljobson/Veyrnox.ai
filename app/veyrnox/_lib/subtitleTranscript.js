export const MAX_SUBTITLE_CUES = 80;
export const MAX_SUBTITLE_CUE_TEXT = 500;

function roundTime(value) {
  return Math.round(value * 1000) / 1000;
}

function chunkWords(text, limit = 72) {
  const chunks = [];
  for (const block of String(text || '').replace(/\r/g, '').split(/\n+|(?<=[.!?])\s+/u)) {
    const words = block.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      if (line && `${line} ${word}`.length > limit) {
        chunks.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) chunks.push(line);
  }
  return chunks.slice(0, MAX_SUBTITLE_CUES);
}

export function cuesFromReviewedScript(script, maxSeconds = 40) {
  const chunks = chunkWords(script);
  if (!chunks.length) return [];
  const safeMax = Math.max(1, Number(maxSeconds) || 40);
  const wordCount = chunks.join(' ').split(/\s+/).length;
  const targetDuration = Math.min(safeMax, Math.max(chunks.length * 1.2, wordCount / 2.5));
  const totalWeight = chunks.reduce((sum, text) => sum + Math.max(1, text.length), 0);
  let cursor = 0;
  return chunks.map((text, index) => {
    const start = roundTime(cursor);
    const remaining = targetDuration - cursor;
    const duration = index === chunks.length - 1
      ? remaining
      : targetDuration * (Math.max(1, text.length) / totalWeight);
    cursor = Math.min(targetDuration, cursor + duration);
    return { id: `cue-${index + 1}`, start, end: roundTime(cursor), text };
  });
}

export function validateSubtitleCues(cues, maxSeconds = 40) {
  if (!Array.isArray(cues) || !cues.length) return { ok: false, errors: ['Add at least one subtitle cue.'] };
  if (cues.length > MAX_SUBTITLE_CUES) return { ok: false, errors: [`Use no more than ${MAX_SUBTITLE_CUES} cues.`] };
  const safeMax = Math.max(1, Number(maxSeconds) || 40);
  const errors = [];
  let previousEnd = 0;
  cues.forEach((cue, index) => {
    const label = `Cue ${index + 1}`;
    const start = cue.start === '' || cue.start == null ? Number.NaN : Number(cue.start);
    const end = cue.end === '' || cue.end == null ? Number.NaN : Number(cue.end);
    const text = String(cue.text || '').trim();
    if (!text) errors.push(`${label} needs text.`);
    if (text.length > MAX_SUBTITLE_CUE_TEXT) errors.push(`${label} is longer than ${MAX_SUBTITLE_CUE_TEXT} characters.`);
    if (!Number.isFinite(start) || start < 0) errors.push(`${label} needs a valid start time.`);
    if (!Number.isFinite(end) || end <= start) errors.push(`${label} must end after it starts.`);
    if (Number.isFinite(end) && end > safeMax) errors.push(`${label} ends after the ${safeMax}-second workflow limit.`);
    if (index > 0 && Number.isFinite(start) && start < previousEnd) errors.push(`${label} overlaps the previous cue.`);
    if (Number.isFinite(end)) previousEnd = end;
  });
  return { ok: errors.length === 0, errors };
}

function timestamp(seconds, decimalMark) {
  const milliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}${decimalMark}${String(millis).padStart(3, '0')}`;
}

export function subtitlesSrt(cues, maxSeconds = 40) {
  const validation = validateSubtitleCues(cues, maxSeconds);
  if (!validation.ok) throw new Error(validation.errors[0]);
  return `${cues.map((cue, index) => `${index + 1}\n${timestamp(cue.start, ',')} --> ${timestamp(cue.end, ',')}\n${String(cue.text).trim()}`).join('\n\n')}\n`;
}

export function subtitlesVtt(cues, maxSeconds = 40) {
  const validation = validateSubtitleCues(cues, maxSeconds);
  if (!validation.ok) throw new Error(validation.errors[0]);
  return `WEBVTT\n\n${cues.map((cue) => `${timestamp(cue.start, '.')} --> ${timestamp(cue.end, '.')}\n${String(cue.text).trim()}`).join('\n\n')}\n`;
}

export function subtitleFileName(language, extension) {
  const locale = String(language || 'subtitles').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subtitles';
  return `veyrnox-${locale}-subtitles.${extension}`;
}
