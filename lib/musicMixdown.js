import { isUuid } from './validate.js';
export const MIXDOWN_MAX_BYTES = 26_214_400;
const key = /^[A-Za-z0-9._-]{8,120}$/;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => keys.includes(k));
const fail = error => ({ ok: false, error });
export function parseMusicMixdown(value) {
  if (!value || !['reserve', 'commit'].includes(value.action)) return fail('invalid_request');
  const common = ['action', 'idempotency_key'];
  if (!exact(value, [...common, ...(value.action === 'commit' ? ['version_id'] :
    ['title', 'size_bytes', 'sha256', 'duration_seconds', 'sources', 'has_takes', 'rights_confirmed'])])) return fail('invalid_request');
  if (typeof value.idempotency_key !== 'string' || !key.test(value.idempotency_key)) return fail('idempotency_key_invalid');
  if (value.action === 'commit') return isUuid(value.version_id || '') ? { ok: true, ...value } : fail('version_id_invalid');
  const title = typeof value.title === 'string' ? value.title.normalize('NFKC').trim() : '';
  if (!title || title.length > 80) return fail('title_invalid');
  if (!Number.isSafeInteger(value.size_bytes) || value.size_bytes < 44 || value.size_bytes > MIXDOWN_MAX_BYTES) return fail('mixdown_size_invalid');
  if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) return fail('sha256_invalid');
  if (!Number.isFinite(value.duration_seconds) || value.duration_seconds <= 0 || value.duration_seconds > 600) return fail('duration_invalid');
  if (typeof value.has_takes !== 'boolean' || (value.has_takes ? value.rights_confirmed !== true :
    value.rights_confirmed !== undefined && value.rights_confirmed !== false)) return fail('rights_confirmation_required');
  if (!Array.isArray(value.sources) || value.sources.length > 16 || value.sources.some(s => !exact(s, ['song_id', 'version_id'])
    || !isUuid(s.song_id || '') || !isUuid(s.version_id || '')) || new Set(value.sources.map(s => s.version_id.toLowerCase())).size !== value.sources.length) return fail('sources_invalid');
  return { ok: true, ...value, title, rights_confirmed: value.rights_confirmed === true,
    sources: value.sources.map(s => ({ song_id: s.song_id.toLowerCase(), version_id: s.version_id.toLowerCase() })).sort((a, b) => a.version_id.localeCompare(b.version_id)) };
}
