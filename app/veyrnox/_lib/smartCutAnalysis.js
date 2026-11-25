import { speechCutLanguage } from '../../../lib/speechCutLanguage.js';
export { SPEECH_CUT_LANGUAGES } from '../../../lib/speechCutLanguage.js';
export const SMART_CUT_ANALYSIS_VERSION = 1;
export const SMART_CUT_PRIMARY_ANALYSIS_PROVIDER = 'fal-scribe-v2';
export const SMART_CUT_ANALYSIS_PROVIDERS = Object.freeze([SMART_CUT_PRIMARY_ANALYSIS_PROVIDER, 'fal-wizper']);
export const SMART_CUT_SILENCE_DEFAULTS = Object.freeze({ minimumSeconds: 0.75, edgePaddingSeconds: 0.12 });
// Pause-removal presets for the speech-aware planner. `natural` is the long-standing default;
// `balanced` is accepted as its alias so the planner can share the demo planner's pacing names.
export const SMART_CUT_SILENCE_PRESETS = Object.freeze({
  snappy: Object.freeze({ minimumSeconds: 0.4, edgePaddingSeconds: 0.08 }),
  natural: SMART_CUT_SILENCE_DEFAULTS,
  relaxed: Object.freeze({ minimumSeconds: 1.2, edgePaddingSeconds: 0.18 }),
});
export function smartCutSilencePreset(name) {
  const key = name === 'balanced' ? 'natural' : name;
  return Object.hasOwn(SMART_CUT_SILENCE_PRESETS, key) ? key : 'natural';
}
// Word-level providers can be cut between any two words; phrase-level providers hide pauses inside a phrase.
export const SMART_CUT_TIMING_QUALITY = Object.freeze({ 'fal-scribe-v2': 'word', 'fal-wizper': 'phrase' });

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
      timingQuality: SMART_CUT_TIMING_QUALITY[value.provider],
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
  // Scribe returns Japanese and Chinese punctuation ("。", "、", "，") as separate "words", often with zero
  // length (probed 2026-11-20). That is not speech and would fail the timestamp check for the whole clip,
  // and a spoken-pause-sized comma token would hide part of the pause; keep only tokens with a letter or digit.
  const words = result.words.filter((word) => word?.type === 'word' && /[\p{L}\p{N}]/u.test(String(word.text ?? '')));
  // Scribe describes a clip with no speech by its audio events, for example "[tone]" for music alone,
  // with an empty word list. Without a word there is nothing to cut around, so that is "no speech"
  // (settled as no speech, not as a failed analysis), whatever the text says.
  if (!words.length) return invalid('analysis_no_speech');
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
  const unique = new Map();
  (clips || []).map((clip, index) => {
    const duration = Number(clip.duration);
    const startValue = clip.in_s ?? clip.rangeStart;
    const endValue = clip.out_s ?? clip.rangeEnd;
    const rangeStart = Math.max(0, Number(startValue) || 0);
    const rangeEnd = Number.isFinite(Number(endValue)) ? Math.min(duration, Number(endValue)) : duration;
    return {
      id: String(clip.uid || clip.job_id || clip.id || ''),
      assetId: String(clip.job_id || clip.assetId || clip.id || ''),
      name: cleanText(clip.name) || `Take ${index + 1}`,
      duration,
      rangeStart,
      rangeEnd,
    };
  }).filter((clip) => clip.id && clip.assetId && finite(clip.duration) && clip.duration > 0 && clip.rangeEnd > clip.rangeStart)
    .forEach((clip) => { if (!unique.has(clip.id)) unique.set(clip.id, clip); });
  return [...unique.values()];
}

function transcriptGroups(analysis, clip, minimumSeconds) {
  const overlapping = analysis.chunks.filter((chunk) => chunk.end > clip.rangeStart && chunk.start < clip.rangeEnd);
  const intersections = overlapping
    .filter((chunk) => chunk.start < clip.rangeStart || chunk.end > clip.rangeEnd)
    .map((chunk) => ({ takeId: clip.id, start: chunk.start, end: chunk.end, text: chunk.text }));
  const entries = overlapping
    .filter((chunk) => chunk.start >= clip.rangeStart && chunk.end <= clip.rangeEnd)
    .map((chunk) => ({
      start: chunk.start,
      end: chunk.end,
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
  return { groups, intersections };
}

function neighbouringUnitBoundaries(group, parsed) {
  const chunks = parsed?.get(group.takeId)?.chunks || [];
  const first = group.entries?.[0];
  const last = group.entries?.at(-1);
  if (!first || !last) return {};
  const previous = chunks.filter((chunk) => chunk.end <= first.start + 1e-9).at(-1);
  const next = chunks.find((chunk) => chunk.start >= last.end - 1e-9);
  return {
    leadingMidpoint: previous ? (previous.end + first.start) / 2 : null,
    trailingMidpoint: next ? (last.end + next.start) / 2 : null,
  };
}

function padGroup(group, clipById, padding, trimIntersections = [], parsed) {
  const clip = clipById.get(group.takeId);
  const leadingBarrier = trimIntersections
    .filter((unit) => unit.takeId === group.takeId && unit.start < clip.rangeStart && unit.end > clip.rangeStart)
    .reduce((bound, unit) => Math.max(bound, unit.end), clip.rangeStart);
  const trailingBarrier = trimIntersections
    .filter((unit) => unit.takeId === group.takeId && unit.start < clip.rangeEnd && unit.end > clip.rangeEnd)
    .reduce((bound, unit) => Math.min(bound, unit.start), clip.rangeEnd);
  const { leadingMidpoint, trailingMidpoint } = neighbouringUnitBoundaries(group, parsed);
  const safeLeadingBarrier = leadingMidpoint == null ? leadingBarrier : Math.max(leadingBarrier, leadingMidpoint + 0.01);
  const safeTrailingBarrier = trailingMidpoint == null ? trailingBarrier : Math.min(trailingBarrier, trailingMidpoint - 0.01);
  const start = Math.min(safeTrailingBarrier, Math.max(safeLeadingBarrier, ceilHundredth(group.start - padding)));
  return { ...group, start, end: Math.max(start, Math.min(floorHundredth(safeTrailingBarrier), floorHundredth(group.end + padding))) };
}

function padAndMerge(groups, clipById, padding, trimIntersections = [], parsed) {
  const padded = groups.map((group) => padGroup(group, clipById, padding, trimIntersections, parsed));
  const merged = [];
  for (const group of padded) {
    const previous = merged.at(-1);
    if (previous && !previous.scriptLine && !group.scriptLine && previous.takeId === group.takeId
      && group.start >= previous.start && group.start <= previous.end) {
      previous.end = Math.max(previous.end, group.end);
      previous.entries.push(...group.entries);
    } else {
      merged.push({ ...group, entries: [...group.entries] });
    }
  }
  return merged;
}

const MIN_PIECE_SECONDS = 0.1;

// Cut reviewed removal ranges (for example filler sounds) out of the kept groups. A piece that no
// longer holds any transcript entry, or is shorter than 0.1 s, is dropped rather than kept as a stub.
function subtractRemovals(groups, removals) {
  if (!removals.length) return groups;
  const out = [];
  for (const group of groups) {
    const cuts = removals
      .filter((cut) => cut.takeId === group.takeId && cut.end > group.start && cut.start < group.end)
      .sort((a, b) => a.start - b.start);
    if (!cuts.length) {
      out.push(group);
      continue;
    }
    const pieces = [];
    let cursor = group.start;
    for (const cut of cuts) {
      if (cut.start > cursor) pieces.push([cursor, Math.min(cut.start, group.end)]);
      cursor = Math.max(cursor, cut.end);
    }
    if (cursor < group.end) pieces.push([cursor, group.end]);
    for (const [from, to] of pieces) {
      const startIntersection = group.entries.find((entry) => entry.start < from && from < entry.end);
      const endIntersection = group.entries.find((entry) => entry.start < to && to < entry.end);
      const start = ceilHundredth(startIntersection ? startIntersection.end : from);
      const end = floorHundredth(endIntersection ? endIntersection.start : to);
      if (end - start < MIN_PIECE_SECONDS) continue;
      const entries = group.entries.filter((entry) => entry.start >= start - 1e-9 && entry.end <= end + 1e-9);
      if (entries.length) out.push({ ...group, start, end, entries });
    }
  }
  return out;
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
  return { groups: reduced.slice(0, MAX_SEGMENTS), omitted: reduced.slice(MAX_SEGMENTS), mergedCount: groups.length - reduced.length };
}

function completeGroupEnd(group, maximumEnd) {
  if (group.end <= maximumEnd + 1e-9) return group.end;
  const complete = group.entries.filter((entry) => entry.end <= maximumEnd + 1e-9).at(-1);
  return complete ? Math.min(group.end, maximumEnd, ceilHundredth(complete.end)) : null;
}

export class SmartCutPlanError extends Error {
  constructor(code, message, parameters = {}) {
    super(message);
    this.name = 'SmartCutPlanError';
    this.code = code;
    this.parameters = parameters;
  }
}

function outputWindowEnd(take, candidateGroups, segments) {
  const kept = segments.filter((segment) => segment.takeId === take.id).sort((a, b) => a.start - b.start);
  if (!kept.length) return null;
  const candidates = candidateGroups.filter((group) => group.takeId === take.id);
  const complete = candidates.every((group) => kept.some((segment) => segment.start <= group.start + 0.01 && segment.end >= group.end - 0.01));
  return complete ? take.rangeEnd : Math.max(...kept.map((segment) => segment.end));
}

function removedSecondsWithinOutput(takes, candidateGroups, segments) {
  return takes.reduce((total, take) => {
    const kept = segments.filter((segment) => segment.takeId === take.id).sort((a, b) => a.start - b.start);
    if (!kept.length) return total;
    const windowEnd = outputWindowEnd(take, candidateGroups, segments);
    const keptSeconds = kept.reduce((sum, segment) => sum + Math.max(0, Math.min(windowEnd, segment.end) - Math.max(take.rangeStart, segment.start)), 0);
    return total + Math.max(0, windowEnd - take.rangeStart - keptSeconds);
  }, 0);
}

function labelFor(group, end = group.end) {
  const label = cleanText(group.entries.filter((entry) => entry.start < end).map((entry) => entry.text).join(' '));
  if (!label) return 'Timed speech section';
  return label.length > 120 ? `${label.slice(0, 117).trimEnd()}…` : label;
}

const terminalSpeech = (text) => /[.!?。！？؟]$/u.test(cleanText(text));

function scriptLines(script) {
  return String(script || '').split(/\n+|(?<=[.!?。！？؟])\s+/u).map(cleanText).filter(Boolean).slice(0, 200);
}

function plannerTokens(text, language) {
  const value = cleanText(text).normalize('NFKC').toLocaleLowerCase(language === 'und' ? undefined : language)
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '').trim();
  if (!value) return [];
  if (['zh', 'ja'].includes(language) || (language === 'ko' && !/\s/u.test(value))) return Array.from(value.replace(/\s/gu, ''));
  return value.split(/\s+/u).filter(Boolean);
}

function tokenOverlap(left, right, budget) {
  budget.remaining -= left.length * right.length;
  if (budget.remaining < 0) throw new SmartCutPlanError('alignment_budget_exceeded', 'The supplied script is too complex to align safely.', {});
  let row = new Uint16Array(right.length + 1);
  for (const token of left) {
    const next = new Uint16Array(right.length + 1);
    for (let index = 0; index < right.length; index += 1) {
      next[index + 1] = token === right[index] ? row[index] + 1 : Math.max(row[index + 1], next[index]);
    }
    row = next;
  }
  return row[right.length];
}

function omitFalseStarts(groups, parsed) {
  const omitted = new Set();
  for (let leftIndex = 0; leftIndex < groups.length; leftIndex += 1) {
    const left = groups[leftIndex];
    const analysis = parsed.get(left.takeId);
    if (!analysis || analysis.language === 'und') continue;
    const leftTokens = plannerTokens(labelFor(left), analysis.language);
    if (leftTokens.length < 2) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      const right = groups[rightIndex];
      if (right.takeId !== left.takeId) continue;
      if (right.start - left.end > 8) break;
      const rightTokens = plannerTokens(labelFor(right), analysis.language);
      if (rightTokens.length <= leftTokens.length) continue;
      if (leftTokens.every((token, index) => token === rightTokens[index])) {
        omitted.add(leftIndex);
        break;
      }
    }
  }
  return {
    groups: groups.filter((_, index) => !omitted.has(index)),
    omitted: groups.filter((_, index) => omitted.has(index)),
  };
}

function omitRepeatedTakes(groups, parsed, takes) {
  if (groups.length < 2) return { groups, omitted: [] };
  const takeOrder = new Map(takes.map((take, index) => [take.id, index]));
  const parent = groups.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const join = (left, right) => {
    const leftRoot = find(left), rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const tokenized = groups.map((group) => {
    const language = parsed.get(group.takeId)?.language;
    if (!language || language === 'und') return [];
    return plannerTokens(labelFor(group), language);
  });
  const budget = { remaining: 2_000_000 };
  let exhausted = false;
  for (let leftIndex = 0; leftIndex < groups.length && !exhausted; leftIndex += 1) {
    const leftTokens = tokenized[leftIndex];
    if (leftTokens.length < 3 || leftTokens.length > 600) continue;
    const leftLanguage = parsed.get(groups[leftIndex].takeId)?.language;
    const leftCounts = leftTokens.reduce((counts, token) => counts.set(token, (counts.get(token) || 0) + 1), new Map());
    for (let rightIndex = leftIndex + 1; rightIndex < groups.length; rightIndex += 1) {
      if (parsed.get(groups[rightIndex].takeId)?.language !== leftLanguage) continue;
      const rightTokens = tokenized[rightIndex];
      if (rightTokens.length < 3 || rightTokens.length > 600) continue;
      const remaining = new Map(leftCounts);
      const shared = rightTokens.reduce((count, token) => {
        const available = remaining.get(token) || 0;
        if (!available) return count;
        remaining.set(token, available - 1);
        return count + 1;
      }, 0);
      if (shared < 3) continue;
      let overlap;
      try {
        overlap = tokenOverlap(leftTokens, rightTokens, budget);
      } catch (error) {
        if (error instanceof SmartCutPlanError && error.code === 'alignment_budget_exceeded') {
          exhausted = true;
          break;
        }
        throw error;
      }
      if (overlap < 3 || overlap / leftTokens.length < 0.6 || overlap / rightTokens.length < 0.45) continue;
      join(leftIndex, rightIndex);
    }
  }

  const clusters = new Map();
  groups.forEach((_, index) => {
    const root = find(index);
    const members = clusters.get(root) || [];
    members.push(index);
    clusters.set(root, members);
  });
  const omittedIndexes = new Set();
  const alternateCandidates = new Map();
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((leftIndex, rightIndex) => {
      const left = groups[leftIndex], right = groups[rightIndex];
      return (takeOrder.get(right.takeId) ?? 0) - (takeOrder.get(left.takeId) ?? 0)
        || right.start - left.start || rightIndex - leftIndex;
    });
    const winnerIndex = ranked[0];
    const winner = groups[winnerIndex];
    const winnerTokens = tokenized[winnerIndex];
    const candidates = [];
    for (const loserIndex of ranked.slice(1)) {
      omittedIndexes.add(loserIndex);
      const loser = groups[loserIndex];
      if (loser.takeId === winner.takeId) continue;
      const loserTokens = tokenized[loserIndex];
      const comparisonBudget = { remaining: winnerTokens.length * loserTokens.length + 1 };
      const overlap = tokenOverlap(winnerTokens, loserTokens, comparisonBudget);
      const coverage = round(overlap / winnerTokens.length);
      const precision = round(overlap / loserTokens.length);
      candidates.push({ ...loser, confidence: round(Math.min(coverage, precision)), coverage, precision });
    }
    if (candidates.length) alternateCandidates.set(winnerIndex, candidates);
  }
  return {
    groups: groups.map((group, index) => {
      if (omittedIndexes.has(index)) return null;
      const candidates = alternateCandidates.get(index);
      return candidates?.length ? { ...group, retakeSelected: true, alternateCandidates: candidates } : group;
    }).filter(Boolean),
    omitted: groups.filter((_, index) => omittedIndexes.has(index)),
  };
}

function boundaryQualityFor({ takeId, start, end }, parsed) {
  const analysis = parsed?.get(takeId);
  const chunks = analysis?.chunks || [];
  const startInsideUnit = chunks.some((chunk) => chunk.start + 1e-9 < start && start < chunk.end - 1e-9);
  const endInsideUnit = chunks.some((chunk) => chunk.start + 1e-9 < end && end < chunk.end - 1e-9);
  return { timingQuality: analysis?.timingQuality || 'unknown', startInsideUnit, endInsideUnit };
}

function planQualityChecks(segments) {
  const checks = segments.map((segment) => {
    const boundaryQuality = segment.boundaryQuality || { timingQuality: 'unknown', startInsideUnit: false, endInsideUnit: false };
    return boundaryQuality.startInsideUnit || boundaryQuality.endInsideUnit
      ? { code: 'clipped_timed_unit', parameters: { segmentId: segment.id, ...boundaryQuality } }
      : { code: 'complete_unit_boundaries', parameters: { segmentId: segment.id, timingQuality: boundaryQuality.timingQuality } };
  });
  segments.filter((segment) => segment.boundaryQuality?.timingQuality === 'phrase').forEach((segment) => {
    checks.push({ code: 'phrase_timing_review', parameters: { segmentId: segment.id } });
  });
  const riskyJoins = [];
  const overlaps = [];
  segments.forEach((segment, index) => segments.slice(0, index).forEach((previous) => {
    if (segment.takeId === previous.takeId && segment.start < previous.end && segment.end > previous.start) {
      overlaps.push({ firstSegmentId: previous.id, secondSegmentId: segment.id, takeId: segment.takeId });
    }
  }));
  for (let index = 1; index < segments.length; index += 1) {
    const left = segments[index - 1];
    const right = segments[index];
    const sourceGap = left.takeId === right.takeId ? round(right.start - left.end) : null;
    if (left.takeId !== right.takeId || sourceGap > 1.5 || !terminalSpeech(left.label)) {
      riskyJoins.push({ fromSegmentId: left.id, toSegmentId: right.id, sourceGap, changesTake: left.takeId !== right.takeId });
    }
  }
  checks.push(overlaps.length
    ? { code: 'source_overlap', parameters: { count: overlaps.length, overlaps } }
    : { code: 'source_ranges_non_overlapping', parameters: { segments: segments.length } });
  riskyJoins.forEach((join) => checks.push({ code: 'join_review', parameters: join }));
  return { checks, riskyJoins, clippedBoundaries: checks.filter((check) => check.code === 'clipped_timed_unit') };
}

function alignScriptGroups(lines, groups, parsed, takes) {
  if (!lines.length) return { groups, missingLines: [], alternateIndexes: new Set(), extraGroups: [] };
  const takeOrder = new Map(takes.map((take, index) => [take.id, index]));
  const budget = { remaining: 2_000_000 };
  const used = new Set();
  const alternateIndexes = new Set();
  const selected = [];
  const missingLines = [];
  for (const [lineIndex, line] of lines.entries()) {
    const candidates = [];
    for (const [groupIndex, group] of groups.entries()) {
      if (used.has(groupIndex)) continue;
      const analysis = parsed.get(group.takeId);
      if (!analysis || analysis.language === 'und') continue;
      const lineTokens = plannerTokens(line, analysis.language);
      const groupText = labelFor(group);
      const groupTokens = plannerTokens(groupText, analysis.language);
      if (!lineTokens.length || !groupTokens.length || lineTokens.length > 600 || groupTokens.length > 600) continue;
      const overlap = tokenOverlap(lineTokens, groupTokens, budget);
      const coverage = overlap / lineTokens.length;
      const precision = overlap / groupTokens.length;
      if (coverage < 0.6 || precision < 0.45) continue;
      const pauses = group.entries.filter((entry, index) => index > 0 && entry.start - group.entries[index - 1].end >= 0.3).length;
      const pauseDensity = pauses / Math.max(1, group.entries.length - 1);
      const terminal = terminalSpeech(groupText) ? 1 : 0;
      const score = round(0.55 * coverage + 0.3 * precision + 0.1 * (1 - pauseDensity) + 0.05 * terminal);
      candidates.push({ groupIndex, group, score, coverage: round(coverage), precision: round(precision), pauseDensity: round(pauseDensity), takeOrder: takeOrder.get(group.takeId) ?? 0 });
    }
    candidates.sort((left, right) => right.score - left.score || left.pauseDensity - right.pauseDensity
      || right.takeOrder - left.takeOrder || left.group.start - right.group.start || left.groupIndex - right.groupIndex);
    const winner = candidates[0];
    if (!winner) { missingLines.push(lineIndex + 1); continue; }
    used.add(winner.groupIndex);
    candidates.slice(1).forEach((candidate) => alternateIndexes.add(candidate.groupIndex));
    selected.push({
      ...winner.group,
      scriptLine: line,
      scriptLineNumber: lineIndex + 1,
      matchConfidence: winner.score,
      matchCoverage: winner.coverage,
      matchPrecision: winner.precision,
      alternateCandidateIndexes: candidates.slice(1).map((candidate) => candidate.groupIndex),
    });
  }
  const safeSelected = selected.map((group) => ({
    ...group,
    alternateCandidates: group.alternateCandidateIndexes.filter((index) => !used.has(index)).map((index) => {
      const candidate = groups[index];
      const analysis = parsed.get(candidate.takeId);
      const lineTokens = plannerTokens(group.scriptLine, analysis.language);
      const candidateTokens = plannerTokens(labelFor(candidate), analysis.language);
      const overlap = tokenOverlap(lineTokens, candidateTokens, budget);
      const coverage = round(overlap / lineTokens.length);
      const precision = round(overlap / candidateTokens.length);
      const pauses = candidate.entries.filter((entry, entryIndex) => entryIndex > 0 && entry.start - candidate.entries[entryIndex - 1].end >= 0.3).length;
      const pauseDensity = round(pauses / Math.max(1, candidate.entries.length - 1));
      const confidence = round(0.55 * coverage + 0.3 * precision + 0.1 * (1 - pauseDensity) + 0.05 * (terminalSpeech(labelFor(candidate)) ? 1 : 0));
      return { ...candidate, confidence, coverage, precision };
    }),
  }));
  const extraGroups = groups.filter((_, index) => !used.has(index) && !alternateIndexes.has(index));
  return { groups: safeSelected, missingLines, alternateIndexes, extraGroups };
}

/** Build the first production planner slice from normalized timed speech. */
export function buildSpeechAwareCutPlan({ clips, analyses, script = '', notes = '', languageOverride = '', silencePreset, minimumSilenceSeconds, edgePaddingSeconds, removals = [] } = {}) {
  const reviewedRemovals = (Array.isArray(removals) ? removals : [])
    .filter((cut) => cut && typeof cut.takeId === 'string' && finite(cut.start) && finite(cut.end) && cut.end > cut.start);
  const presetName = smartCutSilencePreset(silencePreset);
  const preset = SMART_CUT_SILENCE_PRESETS[presetName];
  const requestedLanguage = cleanText(languageOverride);
  const overrideLanguage = requestedLanguage ? speechCutLanguage(requestedLanguage) : null;
  if (requestedLanguage && overrideLanguage === 'und') throw new SmartCutPlanError(
    'language_override_invalid',
    'Choose a supported spoken language or use automatic detection.',
    { language: requestedLanguage },
  );
  const takes = sourceClips(clips);
  if (!takes.length) throw new Error('Speech-aware Smart Cut needs at least one loaded video clip.');
  if (takes.length > MAX_SEGMENTS) throw new SmartCutPlanError(
    'source_clip_limit_reached',
    'Speech-aware Smart Cut supports at most 10 source clips.',
    { sourceClips: takes.length, maximum: MAX_SEGMENTS },
  );
  const minimumSeconds = Number.isFinite(minimumSilenceSeconds)
    ? Math.min(3, Math.max(0.3, minimumSilenceSeconds))
    : preset.minimumSeconds;
  const padding = Number.isFinite(edgePaddingSeconds)
    ? Math.min(0.5, Math.max(0, edgePaddingSeconds))
    : preset.edgePaddingSeconds;
  const clipById = new Map(takes.map((take) => [take.id, take]));
  const parsed = new Map();
  for (const take of takes) {
    const result = parseSmartCutAnalysis(analysisFor(analyses, take.assetId), { assetId: take.assetId, duration: take.duration });
    if (!result.ok) throw new Error(`Speech analysis for ${take.name} is unavailable or invalid (${result.error}).`);
    parsed.set(take.id, overrideLanguage
      ? { ...result.analysis, detectedLanguage: result.analysis.language, language: overrideLanguage }
      : { ...result.analysis, detectedLanguage: result.analysis.language });
  }

  const transcriptResults = takes.map((take) => transcriptGroups(parsed.get(take.id), take, minimumSeconds));
  const rawGroups = transcriptResults.flatMap((result) => result.groups);
  const trimIntersections = transcriptResults.flatMap((result) => result.intersections);
  if (!rawGroups.length && trimIntersections.length) throw new SmartCutPlanError(
    'trim_intersects_unit',
    'No complete timed speech unit fits inside the selected clip ranges.',
    { reason: 'trim_intersects_all_units', units: trimIntersections },
  );
  if (!rawGroups.length) throw new Error('No timed speech was found inside the selected clip ranges.');
  const lines = scriptLines(script);
  const falseStarts = omitFalseStarts(rawGroups, parsed);
  const repeatedTakes = lines.length ? { groups: falseStarts.groups, omitted: [] } : omitRepeatedTakes(falseStarts.groups, parsed, takes);
  const aligned = alignScriptGroups(lines, repeatedTakes.groups, parsed, takes);
  if (lines.length && !aligned.groups.length) throw new SmartCutPlanError(
    'script_match_missing',
    'None of the supplied script lines matched the analysed speech.',
    { count: aligned.missingLines.length, lineNumbers: aligned.missingLines },
  );
  const knownRemovals = reviewedRemovals.filter((cut) => clipById.has(cut.takeId));
  const paddedGroups = padAndMerge(aligned.groups, clipById, padding, trimIntersections, parsed);
  const candidateGroups = subtractRemovals(paddedGroups, knownRemovals);
  const limited = mergeToSegmentLimit(candidateGroups);
  const groups = limited.groups;
  const segments = [];
  const outputOmitted = [];
  let overBudgetUnit = null;
  let outputOffset = 0;
  for (const [index, group] of groups.entries()) {
    const remaining = MAX_OUTPUT_SECONDS - outputOffset;
    if (remaining <= 0.01) {
      outputOmitted.push(...groups.slice(index));
      break;
    }
    const cappedEnd = group.start + remaining;
    const end = completeGroupEnd(group, cappedEnd);
    if (end == null || end <= group.start) {
      overBudgetUnit = group;
      outputOmitted.push(...groups.slice(index));
      break;
    }
    const start = ceilHundredth(group.start);
    const length = round(end - start);
    if (length <= 0) continue;
    const segmentRange = { takeId: group.takeId, start, end };
    segments.push({
      id: `speech-${index + 1}`,
      label: group.scriptLine || labelFor(group, end),
      takeId: group.takeId,
      start,
      end,
      outputOffset: round(outputOffset),
      plannedLength: round(length),
      boundaryQuality: boundaryQualityFor(segmentRange, parsed),
      matchStatus: group.scriptLine ? `Matched script line ${group.scriptLineNumber} (${Math.round(group.matchConfidence * 100)}% confidence).` : 'Matched to timed transcript.',
      alternates: [...new Set((group.alternateCandidates || []).map((candidate) => candidate.takeId))],
      alternateCandidates: (group.alternateCandidates || []).map((candidate) => {
        const padded = padGroup(candidate, clipById, padding, trimIntersections, parsed);
        return {
          takeId: candidate.takeId,
          start: padded.start,
          end: padded.end,
          confidence: candidate.confidence,
          coverage: candidate.coverage,
          precision: candidate.precision,
          boundaryQuality: boundaryQualityFor(padded, parsed),
        };
      }),
      reason: group.scriptLine || group.retakeSelected
        ? `Selected ${clipById.get(group.takeId).name} using transcript coverage, completeness, boundary safety and pause density.`
        : `Kept transcript-backed speech from ${clipById.get(group.takeId).name}; pauses of at least ${minimumSeconds.toFixed(2)} seconds were eligible for removal.`,
      matchCode: group.scriptLine ? 'script_line_matched' : 'transcript_section_kept',
      matchParameters: group.scriptLine ? { line: group.scriptLineNumber, confidence: group.matchConfidence, coverage: group.matchCoverage, precision: group.matchPrecision } : {},
      reasonCode: group.scriptLine || group.retakeSelected ? 'best_take_score' : 'transcript_continuity',
      reasonParameters: group.scriptLine || group.retakeSelected ? { takeId: group.takeId, confidence: group.matchConfidence ?? 1 } : { minimumSilenceSeconds: minimumSeconds },
    });
    outputOffset = round(outputOffset + length);
    if (end < group.end - 0.01) {
      const entries = group.entries.filter((entry) => entry.end > end);
      if (entries.length) outputOmitted.push({ ...group, start: end, entries });
      outputOmitted.push(...groups.slice(index + 1));
      break;
    }
  }
  if (!segments.length && overBudgetUnit) throw new SmartCutPlanError(
    'unit_exceeds_budget',
    'The first complete timed speech unit is longer than the Clip Editor output budget.',
    {
      takeId: overBudgetUnit.takeId,
      start: overBudgetUnit.entries[0]?.start ?? overBudgetUnit.start,
      end: overBudgetUnit.entries[0]?.end ?? overBudgetUnit.end,
    },
  );
  if (!segments.length) throw new Error('No usable speech sections fit inside the Clip Editor limits.');

  const totalDuration = round(segments.reduce((sum, segment) => sum + segment.end - segment.start, 0));
  const detectedLanguages = [...new Set([...parsed.values()].map((analysis) => analysis.detectedLanguage))];
  const effectiveLanguages = [...new Set([...parsed.values()].map((analysis) => analysis.language))];
  const warningDetails = [{ code: 'review_boundaries', parameters: {} }];
  const knownDetectedLanguages = detectedLanguages.filter((language) => language !== 'und');
  if (!overrideLanguage && detectedLanguages.includes('und')) warningDetails.push({ code: 'language_unknown', parameters: {} });
  if (!overrideLanguage && new Set(knownDetectedLanguages).size > 1) {
    warningDetails.push({ code: 'language_mixed', parameters: { languages: knownDetectedLanguages } });
  }
  if (trimIntersections.length) {
    warningDetails.push({ code: 'trim_intersects_unit', parameters: { count: trimIntersections.length, units: trimIntersections } });
  }
  if ([...parsed.values()].some((analysis) => analysis.timingQuality === 'phrase')) {
    warningDetails.push({ code: 'phrase_timing', parameters: {} });
  }
  if (aligned.missingLines.length) warningDetails.push({ code: 'script_incomplete', parameters: { count: aligned.missingLines.length, lineNumbers: aligned.missingLines } });
  if (aligned.extraGroups.length) warningDetails.push({ code: 'extra_speech_omitted', parameters: { count: aligned.extraGroups.length, groups: aligned.extraGroups } });
  if (falseStarts.omitted.length) warningDetails.push({ code: 'false_start_omitted', parameters: { count: falseStarts.omitted.length, groups: falseStarts.omitted } });
  if (repeatedTakes.omitted.length) warningDetails.push({ code: 'retake_omitted', parameters: { count: repeatedTakes.omitted.length, groups: repeatedTakes.omitted } });
  // The 10-section limit can merge a removed range back into a kept section; say so instead of hiding it.
  const relevantRemovals = knownRemovals.filter((cut) => paddedGroups.some((group) => group.takeId === cut.takeId && cut.end > group.start && cut.start < group.end));
  const keptAnyway = relevantRemovals.filter((cut) => {
    const middle = (cut.start + cut.end) / 2;
    return segments.some((segment) => segment.takeId === cut.takeId && segment.start <= middle && middle < segment.end);
  });
  const appliedRemovals = relevantRemovals.filter((cut) => {
    if (keptAnyway.includes(cut)) return false;
    const take = clipById.get(cut.takeId);
    const windowEnd = take ? outputWindowEnd(take, candidateGroups, segments) : null;
    return windowEnd !== null && cut.end > take.rangeStart && cut.start < windowEnd + 0.02;
  });
  if (keptAnyway.length) warningDetails.push({ code: 'removal_retained', parameters: { count: keptAnyway.length } });
  if (limited.mergedCount || limited.omitted.length) {
    warningDetails.push({ code: 'segment_limit_reached', parameters: { mergedGroups: limited.mergedCount, omittedGroups: limited.omitted.length, omitted: limited.omitted } });
  }
  if (outputOmitted.length) {
    warningDetails.push({ code: 'output_limit_reached', parameters: { count: outputOmitted.length, groups: outputOmitted } });
  }
  const quality = planQualityChecks(segments);
  if (quality.clippedBoundaries.length) throw new SmartCutPlanError(
    'unsafe_timed_boundary',
    'Smart Cut refused to place an edit inside a timed speech unit.',
    { boundaries: quality.clippedBoundaries.map((check) => check.parameters) },
  );
  if (quality.riskyJoins.length) warningDetails.push({ code: 'join_review', parameters: { count: quality.riskyJoins.length, joins: quality.riskyJoins } });
  const warnings = warningDetails.map((warning) => warning.code);

  return {
    mode: 'transcript-silence',
    pacing: 'speech',
    pacingLabel: 'Speech aware',
    silencePreset: presetName,
    notes: cleanText(notes),
    scriptProvided: Boolean(cleanText(script)),
    language: overrideLanguage || (effectiveLanguages.length === 1 ? effectiveLanguages[0] : 'und'),
    languageOverride: overrideLanguage,
    detectedLanguages,
    takes,
    segments,
    totalDuration,
    silenceRemoved: round(removedSecondsWithinOutput(takes, candidateGroups, segments)),
    removalsApplied: appliedRemovals.length,
    analysisProviders: [...new Set([...parsed.values()].map((analysis) => analysis.provider))],
    qualityChecks: quality.checks,
    warnings,
    warningDetails,
  };
}

export function swapSpeechAwareCutTake(plan, segmentId, takeId) {
  if (plan?.mode !== 'transcript-silence') return plan;
  const at = plan.segments.findIndex((segment) => segment.id === segmentId);
  const segment = plan.segments[at];
  const candidate = segment?.alternateCandidates?.find((item) => item.takeId === takeId);
  const take = plan.takes.find((item) => item.id === takeId);
  if (!segment || !candidate || !take || candidate.end <= candidate.start) return plan;
  if (plan.segments.some((item, index) => index !== at && item.takeId === takeId && candidate.start < item.end && candidate.end > item.start)) return plan;
  const current = {
    takeId: segment.takeId,
    start: segment.start,
    end: segment.end,
    confidence: Number(segment.matchParameters?.confidence) || 0,
    coverage: Number(segment.matchParameters?.coverage) || 0,
    precision: Number(segment.matchParameters?.precision) || 0,
    boundaryQuality: segment.boundaryQuality,
  };
  const alternateCandidates = [...segment.alternateCandidates.filter((item) => item.takeId !== takeId), current]
    .filter((item, index, values) => values.findIndex((other) => other.takeId === item.takeId) === index);
  const replacement = {
    ...segment,
    takeId,
    start: candidate.start,
    end: candidate.end,
    plannedLength: round(candidate.end - candidate.start),
    boundaryQuality: candidate.boundaryQuality,
    alternates: alternateCandidates.map((item) => item.takeId),
    alternateCandidates,
    matchStatus: `Matched script line ${segment.matchParameters?.line || at + 1} (${Math.round(candidate.confidence * 100)}% confidence).`,
    matchParameters: { ...segment.matchParameters, confidence: candidate.confidence, coverage: candidate.coverage, precision: candidate.precision },
    reason: `You selected ${take.name} from the analysed alternate takes.`,
    reasonCode: 'manual_take',
    reasonParameters: { takeId, confidence: candidate.confidence, manual: true },
  };
  let offset = 0;
  const segments = plan.segments.map((item, index) => index === at ? replacement : item).map((item) => {
    const positioned = { ...item, outputOffset: round(offset) };
    offset = round(offset + item.end - item.start);
    return positioned;
  });
  if (offset > MAX_OUTPUT_SECONDS + 1e-9) return plan;
  const quality = planQualityChecks(segments);
  if (quality.checks.some((check) => check.code === 'source_overlap' || check.code === 'clipped_timed_unit')) return plan;
  const warningDetails = (plan.warningDetails || []).filter((warning) => warning.code !== 'join_review');
  if (quality.riskyJoins.length) warningDetails.push({ code: 'join_review', parameters: { count: quality.riskyJoins.length, joins: quality.riskyJoins } });
  return { ...plan, segments, totalDuration: offset, qualityChecks: quality.checks, warningDetails, warnings: warningDetails.map((warning) => warning.code) };
}
