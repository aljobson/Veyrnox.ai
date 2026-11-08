import { select } from '../packages/db/supabase-client.js';
import { capabilityFor, declaredInputs } from './modelCapabilities.js';
import { readGenerationSources } from './generationSources.js';
import { typeForKey } from './uploadSource.js';
import { checkTemplateClipRequest, TEMPLATE_CLIP_MODELS } from './templateClipGeneration.js';
import { TEMPLATE_CLIP_SOURCES } from './templateClipSources.js';

const ENDPOINTS = TEMPLATE_CLIP_MODELS;
const failure = (error, status = 409) => ({ status, body: { error } });
// JSONB object equality ignores key order; reference arrays retain their order.
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

// Call only after the attempt quota. This path only reads an authenticated
// caller's existing job: it never admits, signs media, debits or dispatches.
// Unpublication must not strand an accepted request whose reply was lost.
export async function replayTemplateClip(authId, body, cfg, { read = select, manifest = TEMPLATE_CLIP_SOURCES } = {}) {
  let job;
  try {
    const users = await read('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
    if (!users?.[0]?.id) return null;
    const jobs = await read('jobs', { columns: 'id,model_id,inputs',
      filter: `user_id=eq.${encodeURIComponent(users[0].id)}&idempotency_key=eq.${encodeURIComponent(body.idempotency_key)}`, limit: 1 }, cfg);
    if (!Array.isArray(jobs)) return failure('admission_unknown', 503);
    if (!jobs.length) return null;
    job = jobs[0];
  } catch { return failure('admission_unknown', 503); }
  const stored = job?.inputs, source = stored?.template_source;
  if (!job?.id || !stored) return failure('admission_unknown', 503);
  if (job.model_id !== body.model_id || source?.template !== body.template_clip || !Object.hasOwn(ENDPOINTS, job.model_id)) return failure('idempotency_conflict');
  // A still-known manifest revision remains part of identity, even if paused.
  const current = Object.hasOwn(manifest, body.template_clip) && manifest[body.template_clip];
  if (current && (current.version !== source.version || current.sha256 !== source.sha256)) return failure('idempotency_conflict');
  const parsed = readGenerationSources(body);
  if (!parsed.ok) return failure(parsed.error, 400);
  const contractError = checkTemplateClipRequest(body, parsed.references, job.model_id);
  if (contractError) return failure(contractError, 400);
  if (body.consent !== true) return failure('consent_required', 400);
  const references = parsed.references.map(ref => ({ ...ref, slot: ref.slot || (ref.origin === 'asset' ? 'image' : typeForKey(ref.key)?.field?.replace(/_url$/, '')) }));
  const record = capabilityFor(ENDPOINTS[job.model_id]);
  // The effective prompt belongs to the server, so prompt revisions do not
  // change the identity of a request the caller already paid for.
  const inputs = declaredInputs(record, { ...body.inputs, duration_seconds: 5 });
  for (const key of ['prompt', 'image_url', 'video_url']) delete inputs[key];
  const incoming = { ...inputs, references, template_source: source };
  const identity = Object.fromEntries(Object.entries(stored).filter(([key]) => !['prompt', 'preset_id', 'source_keys', 'source_assets'].includes(key)));
  if (canonical(incoming) !== canonical(identity)) return failure('idempotency_conflict');
  return { status: 200, body: { job_id: job.id, idempotent: true } };
}
