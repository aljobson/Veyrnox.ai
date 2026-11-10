const KEY = 'veyrnox.performance-draft.v1';

export const PERFORMANCE_DRAFT_WORKFLOWS = ['video-lip-sync', 'talking-photo', 'baby-podcast', 'singing-photo', 'talking-cartoon', 'talking-animal', 'talking-object'];
export const PERFORMANCE_DRAFT_SPEECH = ['script', 'upload', 'record'];
export const MAX_PERFORMANCE_DRAFT_SCRIPT = 360;

export function normalizePerformanceDraft(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const workflow = PERFORMANCE_DRAFT_WORKFLOWS.includes(value.workflow) ? value.workflow : null;
  const speechSource = PERFORMANCE_DRAFT_SPEECH.includes(value.speechSource) ? value.speechSource : null;
  if (!workflow || !speechSource) return null;
  const script = typeof value.script === 'string'
    ? value.script.trim().slice(0, MAX_PERFORMANCE_DRAFT_SCRIPT)
    : '';
  if (speechSource === 'script' && !script) return null;
  return { workflow, speechSource, script: speechSource === 'script' ? script : '' };
}

export function writePerformanceDraft(storage, value) {
  const draft = normalizePerformanceDraft(value);
  if (!storage || !draft) return false;
  try {
    storage.setItem(KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readPerformanceDraft(storage) {
  if (!storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(KEY);
    storage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return normalizePerformanceDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}
