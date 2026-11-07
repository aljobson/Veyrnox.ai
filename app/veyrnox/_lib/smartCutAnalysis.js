import { speechCutLanguage } from '../../../lib/speechCutLanguage.js';
export const SMART_CUT_ANALYSIS_VERSION = 1;
export const SMART_CUT_PRIMARY_ANALYSIS_PROVIDER = 'fal-scribe-v2';
export const SMART_CUT_ANALYSIS_PROVIDERS = Object.freeze([SMART_CUT_PRIMARY_ANALYSIS_PROVIDER, 'fal-wizper']);
export const SMART_CUT_SILENCE_DEFAULTS = Object.freeze({ minimumSeconds: 0.75, edgePaddingSeconds: 0.12 });

const MAX_ANALYSIS_CHUNKS = 10_000;
const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_SEGMENTS = 10;
const MAX_OUTPUT_SECONDS = 60;
const round = (value) => Math.round(value * 100) / 100;
const floorHundredth = (value) => Math.floor(value * 100) / 100;
const ceilHundredth = (value) => Math.max(0, Math.ceil(value * 100 - 1e-9) / 100);
const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function invalid(error) {
  return { ok: false, error };
}

/**
 * Validate the provider-neutral transcript record that may be persisted for a
 * Smart Cut analysis. Provider payloads are untrusted input even when they
 * arrive through a signed webhook, so timestamps fail closed here.
 */
export function parseSmartCutAnalysis(value, { assetId, duration } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('analysis_invalid');
  if (value.version !== SMART_CUT_ANALYSIS_VERSION) return invalid('analysis_version_unsupported');
  if (typeof value.assetId !== 'string' || !value.assetId || (assetId && value.assetId !== assetId)) return invalid('analysis_asset_mismatch');
  if (!finite(value.duration) || value.duration <= 0 || (finite(duration) && Math.abs(value.duration - duration) > 0.1)) return invalid('analysis_duration_mismatch');
  if (!SMART_CUT_ANALYSIS_PROVIDERS.includes(value.provider)) return invalid('analysis_provider_invalid');
  if (typeof value.transcript !== 'string' || value.transcript.length > MAX_TRANSCRIPT_CHARS) return invalid('analysis_transcript_invalid');
  if (value.language != null && (typeof value.language !== 'string' || value.language.length > 32)) return invalid('analysis_language_invalid');
  if (!Array.isArray(value.chunks) || !value.chunks.length || value.chunks.length > MAX_ANALYSIS_CHUNKS) return invalid('analysis_chunks_invalid');

  const chunks = [];
  for (const chunk of value.chunks) {
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) return invalid('analysis_chunk_invalid');
    if (!finite(chunk.start) || !finite(chunk.end) || chunk.start < 0 || chunk.end <= chunk.start || chunk.end > value.duration + 0.05) return invalid('analysis_timestamp_invalid');
    const text = cleanText(chunk.text);
    if (!text || text.length > 1_000) return invalid('analysis_chunk_text_invalid');
    chunks.push({ start: round(chunk.start), end: round(Math.min(value.duration, chunk.end)), text });
  }
  chunks.sort((a, b) => a.start - b.start || a.end - b.end);

  return {
    ok: true,
    analysis: {
      version: SMART_CUT_ANALYSIS_VERSION,
      assetId: value.assetId,
      duration: round(value.duration),
      provider: value.provider,
      transcript: cleanText(value.transcript),
      language: speechCutLanguage(value.language),
      chunks,
    },
  };
}

export function normaliseWizperResult({ assetId, duration, result }) {
  if (!result || !Array.isArray(result.chunks)) return invalid('provider_result_invalid');
  return parseSmartCutAnalysis({
    version: SMART_CUT_ANALYSIS_VERSION,
    assetId,
    duration,
    provider: 'fal-wizper',
    transcript: result.text || '',
    language: Array.isArray(result.languages) ? result.languages[0] : null,
    chunks: result.chunks.map((chunk) => ({
      start: chunk?.timestamp?.[0],
      end: chunk?.timestamp?.[1],
      text: chunk?.text,
    })),
  }, { assetId, duration });
}

export function normaliseScribeResult({ assetId, duration, result }) {
  if (!result || !Array.isArray(result.words)) return invalid('provider_result_invalid');
  const words = result.words.filter((word) => word?.type === 'word');
  if (!words.length && !cleanText(result.text)) return invalid('analysis_no_speech');
  return parseSmartCutAnalysis({
    version: SMART_CUT_ANALYSIS_VERSION,
    assetId,
    duration,
    provider: 'fal-scribe-v2',
    transcript: result.text || '',
    language: result.language_code || null,
    chunks: words.map((word) => ({ start: word.start, end: word.end, text: word.text })),
  }, { assetId, duration });
}

function analysisFor(analyses, assetId) {
  if (analyses instanceof Map) return analyses.get(assetId);
  if (Array.isArray(analyses)) return analyses.find((analysis) => analysis?.assetId === assetId);
  return analyses?.[assetId];
}

function sourceClips(clips) {
  return (clips || []).map((clip, index) => {
    const duration = Number(clip.duration);
    const rangeStart = Math.max(0, Number(clip.in_s) || 0);
    const rangeEnd = Number.isFinite(Number(clip.out_s)) ? Math.min(duration, Number(clip.out_s)) : duration;
    return {
      id: String(clip.uid || clip.job_id || clip.id || ''),
      assetId: String(clip.job_id || clip.assetId || clip.id || ''),
      name: cleanText(clip.name) || `Take ${index + 1}`,
      duration,
      rangeStart,
      rangeEnd,
    };
  }).filter((clip) => clip.id && clip.assetId && finite(clip.duration) && clip.duration > 0 && clip.rangeEnd > clip.rangeStart);
}

function transcriptGroups(analysis, clip, minimumSeconds) {
  const entries = analysis.chunks
    .filter((chunk) => chunk.end > clip.rangeStart && chunk.start < clip.rangeEnd)
    .map((chunk) => ({
      start: Math.max(clip.rangeStart, chunk.start),
      end: Math.min(clip.rangeEnd, chunk.end),
      text: chunk.text,
    }));
  const groups = [];
  for (const entry of entries) {
    const previous = groups.at(-1);
    if (!previous || entry.start - previous.end >= minimumSeconds) {
      groups.push({ takeId: clip.id, start: entry.start, end: entry.end, entries: [entry] });
    } else {
      previous.end = Math.max(previous.end, entry.end);
      previous.entries.push(entry);
    }
  }
  return groups;
}

function padAndMerge(groups, clipById, padding) {
  const padded = groups.map((group) => {
    const clip = clipById.get(group.takeId);
    const start = Math.min(clip.rangeEnd, Math.max(clip.rangeStart, ceilHundredth(group.start - padding)));
    return {
      ...group,
      start,
      end: Math.max(start, Math.min(floorHundredth(clip.rangeEnd), floorHundredth(group.end + padding))),
    };
  });
  const merged = [];
  for (const group of padded) {
    const previous = merged.at(-1);
    if (previous && previous.takeId === group.takeId && group.start <= previous.end) {
      previous.end = Math.max(previous.end, group.end);
      previous.entries.push(...group.entries);
    } else {
      merged.push({ ...group, entries: [...group.entries] });
    }
  }
  return merged;
}

function mergeToSegmentLimit(groups) {
  const reduced = groups.map((group) => ({ ...group, entries: [...group.entries] }));
  while (reduced.length > MAX_SEGMENTS) {
    let candidate = null;
    for (let index = 0; index < reduced.length - 1; index += 1) {
      const left = reduced[index];
      const right = reduced[index + 1];
      if (left.takeId !== right.takeId) continue;
      const gap = Math.max(0, right.start - left.end);
      if (!candidate || gap < candidate.gap) candidate = { index, gap };
    }
    if (!candidate) break;
    const left = reduced[candidate.index];
    const right = reduced[candidate.index + 1];
    reduced.splice(candidate.index, 2, {
      ...left,
      end: right.end,
      entries: [...left.entries, ...right.entries],
    });
  }
  return reduced.slice(0, MAX_SEGMENTS);
}

function labelFor(group, end = group.end) {
  const label = cleanText(group.entries.filter((entry) => entry.start < end).map((entry) => entry.text).join(' '));
  if (!label) return 'Timed speech section';
  return label.length > 120 ? `${label.slice(0, 117).trimEnd()}…` : label;
}

/** Build the first production planner slice from normalized timed speech. */
export function buildSpeechAwareCutPlan({ clips, analyses, minimumSilenceSeconds, edgePaddingSeconds } = {}) {
  const takes = sourceClips(clips);
  if (!takes.length) throw new Error('Speech-aware Smart Cut needs at least one loaded video clip.');
  if (takes.length > MAX_SEGMENTS) throw new Error('Speech-aware Smart Cut supports at most 10 source clips.');
  const minimumSeconds = Number.isFinite(minimumSilenceSeconds)
    ? Math.min(3, Math.max(0.3, minimumSilenceSeconds))
    : SMART_CUT_SILENCE_DEFAULTS.minimumSeconds;
  const padding = Number.isFinite(edgePaddingSeconds)
    ? Math.min(0.5, Math.max(0, edgePaddingSeconds))
    : SMART_CUT_SILENCE_DEFAULTS.edgePaddingSeconds;
  const clipById = new Map(takes.map((take) => [take.id, take]));
  const parsed = new Map();
  for (const take of takes) {
    const result = parseSmartCutAnalysis(analysisFor(analyses, take.assetId), { assetId: take.assetId, duration: take.duration });
    if (!result.ok) throw new Error(`Speech analysis for ${take.name} is unavailable or invalid (${result.error}).`);
    parsed.set(take.id, result.analysis);
  }

  const rawGroups = takes.flatMap((take) => transcriptGroups(parsed.get(take.id), take, minimumSeconds));
  if (!rawGroups.length) throw new Error('No timed speech was found inside the selected clip ranges.');
  const groups = mergeToSegmentLimit(padAndMerge(rawGroups, clipById, padding));
  const segments = [];
  let outputOffset = 0;
  for (const [index, group] of groups.entries()) {
    const remaining = MAX_OUTPUT_SECONDS - outputOffset;
    if (remaining <= 0.01) break;
    const cappedEnd = group.start + remaining;
    const end = group.end <= cappedEnd + 1e-9 ? group.end : floorHundredth(cappedEnd);
    if (end <= group.start) break;
    const start = ceilHundredth(group.start);
    const length = round(end - start);
    if (length <= 0) continue;
    segments.push({
      id: `speech-${index + 1}`,
      label: labelFor(group, end),
      takeId: group.takeId,
      start,
      end,
      outputOffset: round(outputOffset),
      plannedLength: round(length),
      matchStatus: 'Matched to timed transcript.',
      alternates: [],
      reason: `Kept transcript-backed speech from ${clipById.get(group.takeId).name}; pauses of at least ${minimumSeconds.toFixed(2)} seconds were eligible for removal.`,
    });
    outputOffset = round(outputOffset + length);
  }
  if (!segments.length) throw new Error('No usable speech sections fit inside the Clip Editor limits.');

  const totalDuration = round(segments.reduce((sum, segment) => sum + segment.end - segment.start, 0));
  const selectedDuration = round(takes.reduce((sum, take) => sum + take.rangeEnd - take.rangeStart, 0));
  const warnings = ['Transcript timings guide these cuts; review every boundary before creating the video.'];
  if (rawGroups.length > MAX_SEGMENTS) warnings.push('Some short pauses were retained to fit the Clip Editor’s 10-section limit.');
  if (outputOffset >= MAX_OUTPUT_SECONDS - 0.01) warnings.push('The speech-aware plan stopped at the Clip Editor’s 60-second output limit.');

  return {
    mode: 'transcript-silence',
    pacing: 'speech',
    pacingLabel: 'Speech aware',
    notes: '',
    scriptProvided: true,
    takes,
    segments,
    totalDuration,
    silenceRemoved: round(Math.max(0, selectedDuration - totalDuration)),
    analysisProviders: [...new Set([...parsed.values()].map((analysis) => analysis.provider))],
    warnings,
  };
}
