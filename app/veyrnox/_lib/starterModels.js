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
