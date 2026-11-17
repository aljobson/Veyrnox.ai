import { gatewayFetch } from '../../gateway.js';
import { getStoredUserId } from '../../../../lib/authClient.js';
import { localTake, hydrateLocalTakes } from '../localTakes.js';
import { encodeWavChannels } from './beatWav.mjs';
import { recoverTake } from './beatCloudRules.mjs';
const base = '/music/beat-projects';
const path = id => `${base}/${encodeURIComponent(id)}`;
async function call(url, init = {}, options = {}) {
  const check = () => {
    if (!options.userId || options.userId !== getStoredUserId() || options.signal?.aborted)
      throw Object.assign(new Error('Account changed'), { code: 'account_changed' });
  };
  check();
  const result = await gatewayFetch(url, { ...init, signal: options.signal, keepalive: options.keepalive });
  check(); return result;
}
export const listCloudBeats = options => call(base, {}, options);
export const getCloudBeat = (id, options) => call(path(id), {}, options);
export const saveCloudBeat = (id, body, key, options) => call(path(id), { method: 'PUT', body: JSON.stringify(body), headers: { 'Idempotency-Key': key } }, options);
export const removeCloudBeat = (id, revision, options) => call(path(id), { method: 'DELETE', body: JSON.stringify({ expected_revision: revision }) }, options);
export const listVersions = (id, options) => call(`${path(id)}/versions`, {}, options);
export const getVersion = (id, version, options) => call(`${path(id)}/versions/${encodeURIComponent(version)}`, {}, options);
export const listTakes = (id, options) => call(`${path(id)}/takes`, {}, options);
export const takeUrl = (id, take, options) => call(`${path(id)}/takes/${encodeURIComponent(take)}`, {}, options);
export async function uploadTake(id, asset, row, options) {
  const confirm = take => call(`${path(id)}/takes/${encodeURIComponent(take)}`, { method: 'POST', body: '{}' }, options);
  const ready = await recoverTake({ row, confirm,
    reserve: async () => {
      await hydrateLocalTakes();
      const take = localTake(asset.ref);
      if (!take) throw Object.assign(new Error('Only on this device'), { code: 'TAKE_UNAVAILABLE' });
      // The upload is mono 16-bit PCM with a 44-byte header. Check before encoding or reserving.
      if (44 + take.samples.length * 2 > 60000000 || take.seconds > 600)
        throw Object.assign(new Error('Only on this device'), { code: 'INVALID_REQUEST', status: 400 });
      const data = encodeWavChannels([take.samples], take.sampleRate);
      options.uploadData = data;
      return call(`${path(id)}/takes`, { method: 'POST', body: JSON.stringify({ take_ref: asset.ref, byte_size: data.byteLength, duration_sec: take.seconds }) }, options);
    },
    put: reserved => {
      if (options.signal?.aborted || options.userId !== getStoredUserId()) throw Object.assign(new Error('Account changed'), { code: 'account_changed' });
      // A dropped connection rejects with an untagged TypeError: tag it as a transient network failure.
      return fetch(reserved.upload_url, { method: 'PUT', headers: reserved.upload_headers, body: options.uploadData, signal: options.signal, credentials: 'omit' })
        .catch(error => {
          if (options.signal?.aborted || error?.name === 'AbortError') throw error;
          throw Object.assign(new Error('Network error'), { code: 'NETWORK_ERROR' });
        });
    },
  });
  return { ...ready, byte_size: options.uploadData?.byteLength ?? row?.byte_size, duration_sec: asset.durationSec };
}
