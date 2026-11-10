const SNAPSHOT_VERSION = 2;
const HANDOFF_KEY = 'veyrnox.performance-project-handoff.v1';
const HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, allowed) => object(value) && Object.keys(value).length === allowed.length && Object.keys(value).every((key) => allowed.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max ? value : null;
const nullableText = (value, max) => value == null ? null : text(value, max);
const finite = (value, min = 0, max = 1_000_000) => Number.isFinite(value) && value >= min && value <= max;

function source(value, version) {
  const fields = version === 1 ? ['origin', 'name'] : ['role', 'origin', 'name', 'libraryJobId'];
  if (!exact(value, fields)) return null;
  if (!['upload', 'library', 'recording', 'unknown'].includes(value.origin)) return null;
  const name = text(value.name, 160);
  if (!name) return null;
  if (version === 1) return { role: 'unknown', origin: value.origin, name, libraryJobId: null };
  if (!['visual', 'audio', 'background'].includes(value.role)) return null;
  const libraryJobId = value.libraryJobId == null ? null : text(value.libraryJobId, 128);
  if ((value.libraryJobId != null && (!libraryJobId || !SAFE_ID.test(libraryJobId))) || (libraryJobId && value.origin !== 'library')) return null;
  return { role: value.role, origin: value.origin, name, libraryJobId };
}
function normalizeDraft(value, version) {
  if (!exact(value, ['workflowId', 'recipeId', 'avatarId', 'speechSource', 'script', 'ttsSettings', 'composition', 'requiredSources'])) return null;
  if (!SAFE_ID.test(value.workflowId) || !['script', 'upload', 'record'].includes(value.speechSource)) return null;
  if (value.recipeId != null && !SAFE_ID.test(value.recipeId)) return null;
  if (value.avatarId != null && !SAFE_ID.test(value.avatarId)) return null;
  if (typeof value.script !== 'string' || value.script.length > 1000) return null;
  if (!exact(value.ttsSettings, ['voice', 'emotion', 'speed', 'volume', 'pitch', 'language'])) return null;
  if (!exact(value.composition, ['subtitles', 'captionPreset', 'pictureInPicture', 'narration', 'position', 'shape'])) return null;
  if (!Array.isArray(value.requiredSources) || value.requiredSources.length > 3) return null;
  const requiredSources = value.requiredSources.map((item) => source(item, version));
  if (requiredSources.some((item) => !item)) return null;
  const voice = nullableText(value.ttsSettings.voice, 128);
  const language = text(value.ttsSettings.language, 64);
  if ((value.ttsSettings.voice != null && !voice) || !language) return null;
  if (!['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'].includes(value.ttsSettings.emotion)) return null;
  if (!finite(value.ttsSettings.speed, 0.5, 2) || !finite(value.ttsSettings.volume, 0, 10) || !finite(value.ttsSettings.pitch, -12, 12)) return null;
  if (typeof value.composition.subtitles !== 'boolean' || typeof value.composition.pictureInPicture !== 'boolean') return null;
  const captionPreset = text(value.composition.captionPreset, 64);
  const narration = text(value.composition.narration, 64);
  if (!captionPreset || !narration || !['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(value.composition.position) || !['circle', 'original'].includes(value.composition.shape)) return null;
  return { ...value, requiredSources };
}

export function normalizePerformanceProjectSnapshot(value) {
  if (!exact(value, ['version', 'savedAt', 'workflowLabel', 'draft', 'quote', 'jobs'])) return null;
  if (![1, SNAPSHOT_VERSION].includes(value.version) || !text(value.workflowLabel, 160)) return null;
  const savedAt = new Date(value.savedAt);
  if (Number.isNaN(savedAt.getTime())) return null;
  const draft = normalizeDraft(value.draft, value.version);
  if (!draft || !exact(value.quote, ['catalogState', 'speechModelId', 'performanceModelId', 'finishingModelId', 'speechCredits', 'performanceCredits', 'finishingCredits', 'totalCredits'])) return null;
  if (!['live', 'cached'].includes(value.quote.catalogState)) return null;
  for (const key of ['speechModelId', 'performanceModelId', 'finishingModelId']) {
    if (value.quote[key] != null && !SAFE_ID.test(value.quote[key])) return null;
  }
  for (const key of ['speechCredits', 'performanceCredits', 'finishingCredits', 'totalCredits']) {
    if (!finite(value.quote[key])) return null;
  }
  if (!Array.isArray(value.jobs) || value.jobs.length > 20) return null;
  for (const job of value.jobs) {
    if (!exact(job, ['role', 'jobId', 'modelId', 'state', 'credits']) || !text(job.role, 64) || !SAFE_ID.test(job.jobId)) return null;
    if (job.modelId != null && !SAFE_ID.test(job.modelId)) return null;
    if (!text(job.state, 32) || !finite(job.credits)) return null;
  }
  return { ...value, version: SNAPSHOT_VERSION, savedAt: savedAt.toISOString(), draft };
}

export function performanceProjectSnapshot(manifest, draft) {
  const candidate = {
    version: SNAPSHOT_VERSION,
    savedAt: manifest.exported_at,
    workflowLabel: manifest.project.workflow.label,
    draft,
    quote: {
      catalogState: manifest.quote.catalog_state,
      speechModelId: manifest.quote.speech_model_id,
      performanceModelId: manifest.quote.performance_model_id,
      finishingModelId: manifest.quote.finishing_model_id,
      speechCredits: manifest.quote.speech_credits,
      performanceCredits: manifest.quote.performance_credits,
      finishingCredits: manifest.quote.finishing_credits,
      totalCredits: manifest.quote.total_credits,
    },
    jobs: manifest.jobs.slice(0, 20).map((job) => ({ role: job.role, jobId: job.job_id, modelId: job.model_id, state: job.state, credits: job.credits ?? 0 })),
  };
  return normalizePerformanceProjectSnapshot(candidate);
}

export function writePerformanceProjectHandoff(storage, snapshot, now = Date.now()) {
  const normalized = normalizePerformanceProjectSnapshot(snapshot);
  if (!storage || !normalized) return false;
  try {
    storage.setItem(HANDOFF_KEY, JSON.stringify({ at: now, snapshot: normalized }));
    return true;
  } catch { return false; }
}

export function takePerformanceProjectHandoff(storage, now = Date.now()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(HANDOFF_KEY);
    storage.removeItem(HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!Number.isFinite(value.at) || now - value.at > HANDOFF_MAX_AGE_MS) return null;
    return normalizePerformanceProjectSnapshot(value.snapshot);
  } catch { return null; }
}
