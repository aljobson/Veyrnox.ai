import { select } from '../packages/db/supabase-client.js';
import { capabilityFor, declaredInputs } from './modelCapabilities.js';
import { readGenerationSources } from './generationSources.js';
import { typeForKey } from './uploadSource.js';
import { checkTemplateSwapRequest } from './templateSwapClipGeneration.js';
import { loadTemplateSwapClipManifest } from './templateSwapClipManifest.js';
import { envConfig as r2EnvConfig } from '../packages/adapters/r2.js';

import { normaliseSwapRole } from './templateSwapClipRoles.mjs';
import { effectiveSwapRole } from './templateSwapRoleOverrides.mjs';
import { templateSwapPrompt, templateSwapPeoplePrompt } from './templateSwapClipPrompt.mjs';
import { TEMPLATE_SWAP_CLIP_MODEL, TEMPLATE_SWAP_CLIP_ENDPOINT, TEMPLATE_SWAP_CLIP_MANIFEST_SHA256 } from '../app/veyrnox/_lib/templateSwapClips.js';
import { TEMPLATE_SWAP_CRUN_MODEL, TEMPLATE_SWAP_CRUN_ENDPOINT, TEMPLATE_SWAP_CRUN_1080_MODEL, TEMPLATE_SWAP_CRUN_1080_ENDPOINT } from './privateModelIds.js';

// A stored job keeps the supplier it was admitted on, across activation and rollback (ADR-0351 amendment 21).
const ENDPOINTS = { [TEMPLATE_SWAP_CLIP_MODEL]: TEMPLATE_SWAP_CLIP_ENDPOINT, [TEMPLATE_SWAP_CRUN_MODEL]: TEMPLATE_SWAP_CRUN_ENDPOINT, [TEMPLATE_SWAP_CRUN_1080_MODEL]: TEMPLATE_SWAP_CRUN_1080_ENDPOINT };
const failure = (error, status = 409) => ({ status, body: { error } });
// JSONB object equality ignores key order; reference arrays retain their order.
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

// Call only after the attempt quota. This path only reads an authenticated
// caller's existing job: it never admits, signs media, debits or dispatches.
// Unpublication must not strand an accepted request whose reply was lost.
export async function replayTemplateSwapClip(authId, body, cfg, { read = select, readManifest = loadTemplateSwapClipManifest, r2cfg = r2EnvConfig() } = {}) {
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
  if (body.model_id !== TEMPLATE_SWAP_CLIP_MODEL || source?.template !== body.template_swap || !Object.hasOwn(ENDPOINTS, job.model_id)) return failure('idempotency_conflict');
  // A still-known manifest revision remains part of identity, even if paused.
  const manifest = await readManifest(TEMPLATE_SWAP_CLIP_MANIFEST_SHA256, r2cfg);
  const current = manifest && Object.hasOwn(manifest, body.template_swap) && manifest[body.template_swap];
  if (!normaliseSwapRole(source.role) || (current && (current.version !== source.version || current.sha256 !== source.sha256 || effectiveSwapRole(body.template_swap, current.role) !== normaliseSwapRole(source.role)))) return failure('idempotency_conflict');
  const parsed = readGenerationSources(body);
  if (!parsed.ok) return failure(parsed.error, 400);
  // A job accepted as two-person stores both roles in its identity; replay never depends on the switch.
  const people = Array.isArray(source.roles) ? 2 : 1;
  if (people === 2 && source.roles.length !== 2) return failure('idempotency_conflict');
  // A full-body job (amendment 18) stores images: 3; any other value is a conflict. Replay never reads the key.
  if (source.images !== undefined && (people !== 1 || source.images !== 3)) return failure('idempotency_conflict');
  const contractError = checkTemplateSwapRequest(body, parsed.references, TEMPLATE_SWAP_CLIP_MODEL, people, [source.images === 3 ? 3 : people * 2]);
  if (contractError) return failure(contractError, 400);
  if (body.consent !== true) return failure('consent_required', 400);
  const references = parsed.references.map(ref => ({ ...ref, slot: ref.slot || (ref.origin === 'asset' ? 'image' : typeForKey(ref.key)?.field?.replace(/_url$/, '')) }));
  const record = capabilityFor(ENDPOINTS[job.model_id]);
  let prompt;
  try { prompt = people === 2 ? templateSwapPeoplePrompt(source.roles) : templateSwapPrompt(source.role); } catch { return failure('idempotency_conflict'); }
  const inputs = declaredInputs(record, { ...body.inputs, prompt, duration_seconds: 5 });
  for (const key of ['image_url', 'video_url']) delete inputs[key];
  const incoming = { ...inputs, references, template_source: source };
  const identity = Object.fromEntries(Object.entries(stored).filter(([key]) => !['preset_id', 'source_keys', 'source_assets'].includes(key)));
  if (canonical(incoming) !== canonical(identity)) return failure('idempotency_conflict');
  return { status: 200, body: { job_id: job.id, idempotent: true } };
}
