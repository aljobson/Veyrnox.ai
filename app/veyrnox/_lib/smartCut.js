const PACING = {
  snappy: { label: 'Snappy', seconds: 3.2 },
  balanced: { label: 'Balanced', seconds: 4.8 },
  relaxed: { label: 'Relaxed', seconds: 6.5 },
};
export const SMART_CUT_MAX_SEGMENTS = 10;

const round = (value) => Math.round(value * 100) / 100;
const floorHundredth = (value) => Math.floor(value * 100) / 100;
const ceilHundredth = (value) => Math.ceil(value * 100 - 1e-9) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function scriptBeats(script) {
  const text = cleanText(script);
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+|\s*\n+\s*/u)
    .map(cleanText)
    .filter(Boolean)
    .slice(0, 12);
}

function normaliseClips(clips) {
  const unique = new Map();
  (clips || [])
    .map((clip, index) => ({
      id: String(clip.uid || clip.job_id || clip.id || ''),
      assetId: String(clip.job_id || clip.assetId || clip.id || ''),
      name: cleanText(clip.name) || `Take ${index + 1}`,
      duration: Number(clip.duration),
      rangeStart: Math.max(0, Number(clip.in_s) || 0),
      rangeEnd: Number.isFinite(Number(clip.out_s)) ? Math.min(Number(clip.duration), Number(clip.out_s)) : Number(clip.duration),
    }))
    .filter((clip) => clip.id && clip.assetId && Number.isFinite(clip.duration) && clip.duration > 0 && clip.rangeEnd > clip.rangeStart)
    .forEach((clip) => {
      if (!unique.has(clip.id)) unique.set(clip.id, clip);
    });
  return [...unique.values()];
}

function segmentTiming(take, offset, wanted) {
  const start = Math.min(take.rangeEnd, ceilHundredth(clamp(offset, take.rangeStart, take.rangeEnd)));
  const length = floorHundredth(Math.min(wanted, take.rangeEnd - start));
  const end = Math.min(take.rangeEnd, floorHundredth(start + length));
  return { start, end };
}

function retimeSegments(takes, segments) {
  const byId = new Map(takes.map((take) => [take.id, take]));
  const cursors = new Map(takes.map((take) => [take.id, take.rangeStart]));
  const timed = [];
  for (const segment of segments) {
    const take = byId.get(segment.takeId);
    if (!take) return null;
    const timing = segmentTiming(take, cursors.get(take.id), segment.plannedLength);
    if (timing.end <= timing.start || timing.start < (cursors.get(take.id) || take.rangeStart)) return null;
    cursors.set(take.id, timing.end);
    timed.push({ ...segment, start: timing.start, end: timing.end });
  }
  return timed;
}

export const SMART_CUT_PACING = Object.freeze(PACING);

export function smartCutPlanUsesAvailableTakes(plan, clips) {
  const available = new Map(normaliseClips(clips).map((clip) => [clip.id, clip]));
  return Boolean(plan?.segments?.length) && plan.segments.every((segment) => {
    const clip = available.get(segment.takeId);
    return clip
      && Number.isFinite(segment.start)
      && Number.isFinite(segment.end)
      && segment.end > segment.start
      && segment.start >= clip.rangeStart - 0.01
      && segment.end <= clip.rangeEnd + 0.01;
  });
}

export function smartCutPlanWithinLimits(plan) {
  if (!Array.isArray(plan?.segments) || !plan.segments.length || plan.segments.length > SMART_CUT_MAX_SEGMENTS) return false;
  const total = plan.segments.reduce((sum, segment) => sum + Number(segment.end) - Number(segment.start), 0);
  return Number.isFinite(total) && total > 0 && total <= 60 + 1e-9;
}

/**
 * Build a deterministic, local-only edit suggestion. It does not transcribe,
 * score faces or call a provider; users must review every proposed cut.
 */
export function buildSmartCutPlan({ clips, script = '', notes = '', pacing = 'balanced' } = {}) {
  const takes = normaliseClips(clips);
  if (!takes.length) throw new Error('Smart Cut needs at least one loaded video clip.');

  const pace = PACING[pacing] || PACING.balanced;
  const beats = scriptBeats(script);
  const labels = beats.length
    ? beats
    : takes.map((take, index) => `Review ${take.name}${takes.length === 1 ? '' : ` · section ${index + 1}`}`);
  const warnings = [
    'Local demo plan: speech, faces and technical quality are not analysed yet.',
    'Review every cut and take choice before creating the video.',
  ];
  if (takes.length === 1) warnings.push('Only one take is available, so alternate-take swapping is disabled.');
  if (!beats.length) warnings.push('No script was supplied; sections are based on the selected clip order.');
  if (cleanText(notes)) warnings.push('Editing notes are reference only, stay in this open editor session, and are never sent anywhere.');

  let outputOffset = 0;
  const cursorByTake = new Map(takes.map((take) => [take.id, take.rangeStart]));
  const segments = [];
  for (const [index, label] of labels.entries()) {
    const remaining = 60 - outputOffset;
    if (remaining < 0.01 || segments.length >= SMART_CUT_MAX_SEGMENTS) break;
    const wanted = Math.min(remaining, pace.seconds, Math.max(1.5, cleanText(label).split(' ').length / 2.5));
    const selected = Array.from({ length: takes.length }, (_, offset) => takes[(index + offset) % takes.length])
      .find((take) => (cursorByTake.get(take.id) || take.rangeStart) < take.rangeEnd - 0.01);
    if (!selected) break;
    const timing = segmentTiming(selected, cursorByTake.get(selected.id) || selected.rangeStart, wanted);
    if (timing.end <= timing.start) break;
    const segment = {
      id: `section-${index + 1}`,
      label,
      takeId: selected.id,
      start: timing.start,
      end: timing.end,
      outputOffset: round(outputOffset),
      plannedLength: wanted,
      matchStatus: 'Script line is not matched to speech in this local demo.',
      alternates: takes.filter((take) => take.id !== selected.id).map((take) => take.id),
      reason: takes.length > 1
        ? `Rotated to ${selected.name} so adjacent sections do not default to one take.`
        : `${selected.name} is the only available take.`,
    };
    cursorByTake.set(selected.id, timing.end);
    outputOffset += timing.end - timing.start;
    segments.push(segment);
  }

  const totalDuration = round(segments.reduce((sum, segment) => sum + segment.end - segment.start, 0));
  if (segments.length < labels.length) warnings.push('The local plan stopped at the 10-section, 60-second, or available-footage limit; remaining script sections were not added.');

  return {
    mode: 'local-demo',
    pacing: pacing in PACING ? pacing : 'balanced',
    pacingLabel: pace.label,
    notes: cleanText(notes),
    scriptProvided: beats.length > 0,
    takes,
    segments,
    totalDuration,
    warnings,
  };
}

export function swapSmartCutTake(plan, segmentId, takeId) {
  if (plan?.mode === 'transcript-silence') return {
    ...plan,
    warnings: [...new Set([...plan.warnings, 'Transcript-backed sections stay on their analysed source take.'])],
  };
  const take = plan?.takes?.find((item) => item.id === takeId);
  if (!take) return plan;
  const proposed = plan.segments.map((segment) => {
    if (segment.id !== segmentId) return segment;
    return {
      ...segment,
      takeId,
      alternates: plan.takes.filter((item) => item.id !== takeId).map((item) => item.id),
      reason: `You selected ${take.name} as the alternate for this section.`,
    };
  });
  const segments = retimeSegments(plan.takes, proposed);
  if (!segments) return {
    ...plan,
    warnings: [...new Set([...plan.warnings, 'That alternate does not have enough unused footage for this plan. The previous take remains selected.'])],
  };
  const totalDuration = round(segments.reduce((sum, segment) => sum + segment.end - segment.start, 0));
  if (segments.length > SMART_CUT_MAX_SEGMENTS || totalDuration > 60) return {
    ...plan,
    warnings: [...new Set([...plan.warnings, 'That alternate would push the plan past the Clip Editor limits. The previous take remains selected.'])],
  };
  let outputOffset = 0;
  const positioned = segments.map((segment) => {
    const next = { ...segment, outputOffset: round(outputOffset) };
    outputOffset += segment.end - segment.start;
    return next;
  });
  return {
    ...plan,
    segments: positioned,
    totalDuration,
  };
}

export function applySmartCutState(state, nextItems) {
  return {
    items: nextItems,
    smartCutSnapshot: state.smartCutSnapshot || state.items,
  };
}

export function undoSmartCutState(state) {
  if (!state.smartCutSnapshot) return state;
  return { items: state.smartCutSnapshot, smartCutSnapshot: null };
}
