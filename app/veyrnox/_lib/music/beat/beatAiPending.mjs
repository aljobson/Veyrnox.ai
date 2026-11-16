import { validBeatId } from './beatDocument.mjs';
import { validAsset } from './beatAudioRules.mjs';
import { aiPaths, AI_LABELS, AI_INSTRUMENTS } from './beatAi.mjs';
const prefix = 'veyrnox.beat.ai.';
const id = v => typeof v === 'string' && /^[tra][0-9a-z]{1,12}$/.test(v);
const ticks = n => Number.isSafeInteger(n) && n >= 0 && n <= 512 * 3840 && n % 240 === 0;
export function placementIds(key) {
  // Two independent hashes make deterministic valid ids; clashes are refused by placement.
  let a = 2166136261, b = 5381;
  for (const c of key) { a = Math.imul(a ^ c.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ c.charCodeAt(0); }
  const stem = ((BigInt(a >>> 0) << 32n) | BigInt(b >>> 0)).toString(36).padStart(13, '0').slice(0, 9);
  return ['a', 'b'].map(s => ({ track: `t${stem}${s}`, region: `r${stem}${s}`, asset: `a${stem}${s}` }));
}
export function validPending(r) {
  if (!r || !Object.hasOwn(AI_LABELS, r.op) || !validBeatId(r.quoteId)
    || !/^beat-ai\.[0-9a-f-]{36}$/i.test(r.key || '') || !validBeatId(r.key.slice(8))
    || typeof r.prompt !== 'string' || r.prompt.length > 400 || !Number.isSafeInteger(r.createdAt) || r.createdAt < 0
    || !['pending', 'accepted', 'placed'].includes(r.state) || (r.requestId != null && !validBeatId(r.requestId))) return false;
  if (r.op !== 'generate' && (!r.source || !validBeatId(r.source.songId) || !validBeatId(r.source.versionId)
    || !id(r.source.assetId) || !validAsset(r.source.asset, 120) || r.source.asset.source !== 'song'
    || r.source.asset.ref.songId !== r.source.songId || r.source.asset.ref.versionId !== r.source.versionId)) return false;
  if (r.op === 'generate' && r.source !== null) return false;
  if (r.op === 'targetStems' && !AI_INSTRUMENTS.includes(r.instrument)) return false;
  const p = r.placement;
  return r.submitPath === aiPaths(r.op, r.source?.songId).submit && !!p && ticks(p.start) && ticks(p.length) && p.length > 0
    && Number.isFinite(p.phaseSec) && p.phaseSec >= 0 && p.phaseSec < 600
    && (p.afterTrackId === null || id(p.afterTrackId)) && (p.sourceTrackId === null || id(p.sourceTrackId))
    && ticks(p.cycle?.start) && ticks(p.cycle?.end) && p.cycle.end > p.cycle.start
    && JSON.stringify(r.placementIds) === JSON.stringify(placementIds(r.key));
}
export function readPending(beatId, storage = globalThis.localStorage) {
  try {
    const rows = JSON.parse(storage.getItem(prefix + beatId) || '[]');
    return Array.isArray(rows) && rows.length <= 8 ? rows.filter(validPending) : [];
  } catch { return []; }
}
export function writePending(beatId, record, storage = globalThis.localStorage) {
  if (!validPending(record)) throw new Error('Could not keep this request safely.');
  const rows = readPending(beatId, storage).filter(r => r.key !== record.key);
  if (rows.length >= 8) throw new Error('Finish a pending request before starting another.');
  rows.push(record);
  try { storage.setItem(prefix + beatId, JSON.stringify(rows)); }
  catch { throw new Error('Could not save this request on this device. Free some storage and try again.'); }
}
export function retirePending(beatId, key, storage = globalThis.localStorage) {
  storage.setItem(prefix + beatId, JSON.stringify(readPending(beatId, storage).filter(r => r.key !== key)));
}
// Synchronous exclusion is independent of React's next render, including rapid taps.
export function singleFlight() {
  let flight = null;
  return work => {
    if (flight) return flight;
    flight = Promise.resolve().then(work).finally(() => { flight = null; });
    return flight;
  };
}
export async function submitPending(record, request) {
  return request(record.submitPath, { method: 'POST', body: JSON.stringify({ quote_id: record.quoteId, idempotency_key: record.key }) });
}
