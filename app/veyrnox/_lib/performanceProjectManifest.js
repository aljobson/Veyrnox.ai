const SCHEMA = 'https://veyrnox.ai/schemas/performance-project/v1';
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
export const PERFORMANCE_PROJECT_MAX_BYTES = 256 * 1024;

function text(value, fallback = null) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function sourceDescriptor(source, origin = 'upload') {
  if (!source) return { origin: 'none' };
  if (source.jobId) {
    return {
      origin: 'library',
      name: text(source.label || source.name, 'Library asset'),
      library_job_id: text(source.jobId),
    };
  }
  const file = source.file;
  if (!file) return { origin: text(origin, 'upload'), name: text(source.name) };
  return {
    origin: text(origin, 'upload'),
    name: text(file.name || source.name, 'Local file'),
    mime_type: text(file.type),
    size_bytes: finite(file.size),
  };
}

function jobDescriptor(job) {
  if (!job?.job_id || !SAFE_ID.test(String(job.job_id))) return null;
  return {
    role: text(job.role, 'result'),
    job_id: String(job.job_id),
    model_id: text(job.model_id),
    state: text(job.state, 'unknown'),
    credits: finite(job.credits),
  };
}

export function buildPerformanceProjectManifest({
  exportedAt,
  workflow,
  recipeId,
  visual,
  audio,
  background,
  speechSource = 'script',
  script = '',
  ttsSettings = {},
  composition = {},
  quote = {},
  models = {},
  consent = false,
  avatar = null,
  jobs = [],
  catalogLive = false,
} = {}) {
  if (!workflow?.id || !workflow?.label || !SAFE_ID.test(String(workflow.id))) {
    throw new Error('invalid_performance_project');
  }
  const when = new Date(exportedAt || Date.now());
  if (Number.isNaN(when.getTime())) throw new Error('invalid_performance_project');
  const uniqueJobs = [];
  const seen = new Set();
  for (const candidate of jobs) {
    const item = jobDescriptor(candidate);
    if (!item || seen.has(item.job_id)) continue;
    seen.add(item.job_id);
    uniqueJobs.push(item);
  }

  const speech = speechSource === 'script'
    ? {
        source: 'script',
        script: String(script || ''),
        voice: text(ttsSettings.voice),
        emotion: text(ttsSettings.emotion),
        speed: finite(ttsSettings.speed),
        volume: finite(ttsSettings.volume),
        pitch: finite(ttsSettings.pitch),
        language: text(ttsSettings.language),
      }
    : {
        source: speechSource === 'record' ? 'record' : 'upload',
        audio: sourceDescriptor(audio, speechSource === 'record' ? 'recording' : 'upload'),
      };

  return {
    schema: SCHEMA,
    exported_at: when.toISOString(),
    project: {
      workflow: {
        id: String(workflow.id),
        label: String(workflow.label),
        source_kind: text(workflow.sourceKind),
        max_seconds: finite(workflow.maxSeconds),
      },
      recipe_id: text(recipeId),
      avatar_passport: avatar ? { id: text(avatar.id), name: text(avatar.name) } : null,
    },
    sources: {
      visual: sourceDescriptor(visual),
      background: sourceDescriptor(background),
    },
    speech,
    composition: {
      subtitles: Boolean(composition.subtitles),
      caption_preset: text(composition.captionPreset),
      picture_in_picture: Boolean(composition.pictureInPicture),
      narration: text(composition.narration),
      position: text(composition.position),
      shape: text(composition.shape),
    },
    quote: {
      catalog_state: catalogLive ? 'live' : 'cached',
      speech_model_id: text(models.speech),
      performance_model_id: text(models.performance),
      finishing_model_id: text(models.finishing),
      speech_credits: finite(quote.speechCredits) ?? 0,
      performance_credits: finite(quote.lipSyncCredits) ?? 0,
      finishing_credits: finite(quote.captionsCredits) ?? 0,
      total_credits: finite(quote.totalCredits) ?? 0,
    },
    approval: {
      consent_was_checked: Boolean(consent),
      reusable_authorization: false,
      statement: 'This records the project UI state only. Reconfirm current rights, consent, price and sources before any new generation.',
    },
    jobs: uniqueJobs,
    portability: {
      includes_media_bytes: false,
      includes_asset_urls: false,
      includes_access_tokens: false,
      note: 'Re-select local files or resolve owned Library job IDs after import. This manifest does not grant access to media.',
    },
  };
}

export function buildPerformanceProjectDownload(input) {
  const manifest = buildPerformanceProjectManifest(input);
  const date = manifest.exported_at.slice(0, 10);
  return {
    filename: `veyrnox-${manifest.project.workflow.id}-${date}.json`,
    mimeType: 'application/json',
    text: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

function limitedText(value, max = 1000) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function ranged(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback;
}

function sourceRequirement(source, role) {
  if (!source || source.origin === 'none') return null;
  return {
    role,
    origin: ['upload', 'library', 'recording'].includes(source.origin) ? source.origin : 'unknown',
    name: limitedText(source.name, 160) || 'Source media',
    libraryJobId: source.origin === 'library' && SAFE_ID.test(String(source.library_job_id || '')) ? String(source.library_job_id) : null,
  };
}

export function parsePerformanceProjectManifest(input, { allowedWorkflowIds = [] } = {}) {
  let document;
  try {
    document = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    throw new Error('invalid_project_json');
  }
  if (!document || typeof document !== 'object' || document.schema !== SCHEMA) {
    throw new Error('unsupported_project_schema');
  }
  const workflowId = String(document.project?.workflow?.id || '');
  if (!SAFE_ID.test(workflowId) || (allowedWorkflowIds.length && !allowedWorkflowIds.includes(workflowId))) {
    throw new Error('unsupported_project_workflow');
  }
  const speechSource = ['script', 'upload', 'record'].includes(document.speech?.source)
    ? document.speech.source
    : 'script';
  const recipeId = document.project?.recipe_id == null ? null : String(document.project.recipe_id);
  const avatarId = document.project?.avatar_passport?.id == null ? null : String(document.project.avatar_passport.id);
  const composition = document.composition || {};
  const speech = document.speech || {};

  return {
    workflowId,
    recipeId: recipeId && SAFE_ID.test(recipeId) ? recipeId : null,
    avatarId: avatarId && SAFE_ID.test(avatarId) ? avatarId : null,
    speechSource,
    script: speechSource === 'script' ? String(speech.script || '').slice(0, 1000) : '',
    ttsSettings: {
      voice: limitedText(speech.voice, 128),
      emotion: ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'disgusted'].includes(speech.emotion) ? speech.emotion : 'neutral',
      speed: ranged(speech.speed, 1, 0.5, 2),
      volume: ranged(speech.volume, 1, 0, 10),
      pitch: ranged(speech.pitch, 0, -12, 12),
      language: limitedText(speech.language, 64) || 'auto',
    },
    composition: {
      subtitles: Boolean(composition.subtitles),
      captionPreset: limitedText(composition.caption_preset, 64) || 'simple',
      pictureInPicture: Boolean(composition.picture_in_picture),
      narration: limitedText(composition.narration, 64) || 'speech',
      position: ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(composition.position) ? composition.position : 'bottom-right',
      shape: ['circle', 'original'].includes(composition.shape) ? composition.shape : 'circle',
    },
    requiredSources: [
      sourceRequirement(document.sources?.visual, 'visual'),
      speechSource === 'script' ? null : sourceRequirement(speech.audio, 'audio'),
      sourceRequirement(document.sources?.background, 'background'),
    ].filter(Boolean),
  };
}
