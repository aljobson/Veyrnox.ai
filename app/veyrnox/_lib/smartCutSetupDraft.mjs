const PREFIX = 'veyrnox-smart-cut-setup-v1';
const SAFE_OWNER = /^[A-Za-z0-9_-]{1,80}$/;
const PACING = new Set(['snappy', 'balanced', 'relaxed']);
const LANGUAGE = /^(auto|[a-z]{2,3}(?:-[A-Z]{2})?)$/;

const identity = (actor) => {
  const owner = actor || 'guest';
  if (!SAFE_OWNER.test(owner)) throw new Error('This Smart Cut draft belongs to an invalid session.');
  return `${PREFIX}:${owner}`;
};

const cleanClip = (clip) => {
  const jobId = String(clip?.job_id || '');
  const uid = String(clip?.uid || jobId);
  const start = Number(clip?.in_s ?? 0);
  const end = clip?.out_s == null ? null : Number(clip.out_s);
  if (!jobId || jobId.length > 100 || !uid || uid.length > 140 || !Number.isFinite(start) || start < 0
    || (end !== null && (!Number.isFinite(end) || end <= start))) return null;
  return { jobId, uid, start, end };
};

const clipSignature = (clips) => {
  const clean = clips.map(cleanClip);
  return clean.every(Boolean) && clean.length > 0 ? JSON.stringify(clean) : '';
};

function validSetup(value) {
  return value && typeof value.script === 'string' && value.script.length <= 20_000
    && typeof value.notes === 'string' && value.notes.length <= 2_000
    && PACING.has(value.pacing) && LANGUAGE.test(value.language)
    && typeof value.removeFillers === 'boolean'
    && Array.isArray(value.skippedFillers) && value.skippedFillers.length <= 500
    && value.skippedFillers.every((item) => typeof item === 'string' && item.length <= 180);
}
const safeSetup = (setup) => ({
  script: setup.script, notes: setup.notes, pacing: setup.pacing, language: setup.language,
  removeFillers: setup.removeFillers, skippedFillers: [...setup.skippedFillers],
});

export function smartCutSetupHasWork(setup) {
  return Boolean(setup && (setup.script.trim() || setup.notes.trim() || setup.pacing !== 'balanced'
    || setup.language !== 'auto' || setup.removeFillers || setup.skippedFillers.length));
}

export function readSmartCutSetupDraft(storage, actor, clips) {
  if (!storage) return null;
  const key = identity(actor);
  let raw;
  try { raw = storage.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !Number.isSafeInteger(value.updatedAt) || value.clipSignature !== clipSignature(clips)
      || !validSetup(value.setup) || !smartCutSetupHasWork(value.setup)) {
      try { storage.removeItem(key); } catch { /* Storage may be blocked; the invalid value is never returned. */ }
      return null;
    }
    return { setup: safeSetup(value.setup), updatedAt: value.updatedAt };
  } catch {
    try { storage.removeItem(key); } catch { /* Storage may be blocked; the invalid value is never returned. */ }
    return null;
  }
}

export function writeSmartCutSetupDraft(storage, actor, clips, setup, updatedAt = Date.now()) {
  if (!storage) throw new Error('Local Smart Cut draft storage is unavailable.');
  const signature = clipSignature(clips);
  if (!signature || !validSetup(setup)) throw new Error('Smart Cut setup draft is invalid.');
  storage.setItem(identity(actor), JSON.stringify({ version: 1, updatedAt, clipSignature: signature, setup: safeSetup(setup) }));
  return updatedAt;
}

export function removeSmartCutSetupDraft(storage, actor) {
  try { storage?.removeItem(identity(actor)); } catch { /* Private storage can be unavailable without breaking editing. */ }
}
