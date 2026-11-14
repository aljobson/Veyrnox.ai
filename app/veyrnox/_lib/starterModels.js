export const CREATE_GOALS = [
  { id: 'image', label: 'Make an image' },
  { id: 'video', label: 'Make a video' },
  { id: 'audio', label: 'Make audio' },
  { id: 'all', label: 'All models' },
];

export function modelsForGoal(models, goal) {
  if (goal === 'all') return models;
  return models.filter((model) => model.kind === goal);
}

function hasRequiredMedia(model) {
  return Object.values(model.media || {}).some((slot) => slot?.required);
}

function canStartFromPrompt(model) {
  return !model.gated
    && !model.isEdit
    && !model.takesPlan
    && !model.takesTopic
    && model.takesPrompt !== false
    && !hasRequiredMedia(model)
    && Number.isFinite(model.credits)
    && model.credits >= 0;
}

export function starterModel(models, goal = 'image') {
  const candidates = modelsForGoal(models, goal).filter(canStartFromPrompt);
  return [...candidates].sort((a, b) => (
    a.credits - b.credits
    || String(a.name || a.id).localeCompare(String(b.name || b.id))
    || String(a.id).localeCompare(String(b.id))
  ))[0] || null;
}

export function affordableStarterModel(models, preferredId, maxCredits) {
  const affordable = models
    .filter(canStartFromPrompt)
    .filter((model) => model.credits <= maxCredits);
  const preferred = affordable.find((model) => model.id === preferredId);
  if (preferred) return preferred;
  return [...affordable].sort((a, b) => (
    a.credits - b.credits
    || String(a.name || a.id).localeCompare(String(b.name || b.id))
    || String(a.id).localeCompare(String(b.id))
  ))[0] || starterModel(models, 'all');
}

// What the slip charges before the visitor touches the length: 5 s when the
// model sells it, else its first length, doubled for 10 s (the slip's rule).
export function defaultLengthCredits(model) {
  if (model.kind !== 'video' || !model.durations?.length) return model.credits;
  const seconds = model.durations.includes(5) ? 5 : model.durations[0];
  return model.credits * (seconds === 10 ? 2 : 1);
}

// The cheapest prompt-only video the welcome balance pays for at its default
// length, or null when the live catalog has none.
export function affordableVideoModel(models, maxCredits) {
  return modelsForGoal(models, 'video')
    .filter(canStartFromPrompt)
    .filter((model) => defaultLengthCredits(model) <= maxCredits)
    .sort((a, b) => (
      defaultLengthCredits(a) - defaultLengthCredits(b)
      || String(a.name || a.id).localeCompare(String(b.name || b.id))
      || String(a.id).localeCompare(String(b.id))
    ))[0] || null;
}

// The slip's free-credit line: what the welcome balance has left after this
// price, or how much of the price it covers.
export function freeCreditLine(cost, grant) {
  return cost <= grant
    ? { fits: true, left: grant - cost }
    : { fits: false, covered: grant, cost };
}
