import { generationSlotKind } from './generationSourceSlots.mjs';

export const CREATE_DRAFT_STORAGE = 'veyrnox_create_recovery_v1';
export const VEY_WORKSPACE_STORAGE = 'veyrnox_vey_workspace_v1';
const AGE = 86400000;
const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const identifier = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : null;
const strings = value => Object.fromEntries(Object.entries(value || {}).filter(([key, val]) => key.length < 80 && (typeof val === 'string' || typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val)))).slice(0, 60).map(([key, val]) => [key, typeof val === 'string' ? val.slice(0, 2000) : val]));
const storageName = (base, owner) => `${base}:${owner}`;
function read(storage, base, owner, now) {
  try {
    const value = JSON.parse(storage.getItem(storageName(base, owner)));
    return value?.version === 1 && value.owner === owner && Number.isFinite(value.at) && value.at <= now + 60000 && now - value.at < AGE ? value : null;
  } catch { return null; }
}
export function cleanCreateDraft(value) {
  if (!value || typeof value.modelId !== 'string' || !/^[\w.-]{1,100}$/.test(value.modelId)) return null;
  return {
    modelId: value.modelId, goal: ['image', 'video', 'audio', 'all'].includes(value.goal) ? value.goal : 'all',
    prompt: typeof value.prompt === 'string' ? text(value.prompt, 10000) : null,
    duration: /^\d{1,3}s$/.test(value.duration) ? value.duration : '5s',
    aspect: ['16:9', '9:16', '1:1', '4:5', '21:9'].includes(value.aspect) ? value.aspect : '16:9',
    count: Number.isInteger(value.count) && value.count >= 1 && value.count <= 4 ? value.count : 1,
    seed: text(value.seed, 40), negative: text(value.negative), voice: text(value.voice),
    audioDurations: strings(value.audioDurations), cinemaOn: value.cinemaOn === true, cinema: strings(value.cinema),
    characterOn: value.characterOn === true, character: strings(value.character),
    sources: Object.fromEntries(Object.entries(value.sources || {}).filter(([slot, source]) => generationSlotKind(slot) && identifier(source?.assetId))
      .map(([slot, source]) => [slot, { assetId: source.assetId, label: text(source.label, 200) }])),
    needsUpload: value.needsUpload === true || Object.values(value.sources || {}).some(source => !!source?.file),
  };
}
export function readCreateDraft(storage, owner, now = Date.now()) {
  return cleanCreateDraft(read(storage, CREATE_DRAFT_STORAGE, owner, now));
}
export function writeCreateDraft(storage, owner, draft, now = Date.now()) {
  const clean = cleanCreateDraft(draft);
  if (!clean) return false;
  try { storage.setItem(storageName(CREATE_DRAFT_STORAGE, owner), JSON.stringify({ ...clean, version: 1, owner, at: now })); return true; }
  catch { return false; }
}
export async function reopenDraftSources(sources, fetchAsset) {
  const restored = {}, failed = [];
  await Promise.all(Object.entries(sources).map(async ([slot, source]) => {
    try {
      const asset = await fetchAsset(`/jobs/${encodeURIComponent(source.assetId)}/asset`);
      if (!String(asset.mime_type).startsWith(`${generationSlotKind(slot)}/`) || !/^https?:\/\//.test(asset.url)) throw Error('invalid_source');
      restored[slot] = { assetId: source.assetId, previewUrl: asset.url, label: source.label || 'Restored Library source' };
    } catch { failed.push(slot); }
  }));
  return { restored, failed };
}
export function readVeyWorkspace(storage, owner, now = Date.now()) {
  const value = read(storage, VEY_WORKSPACE_STORAGE, owner, now);
  return { open: value?.open === true, chatting: value?.chatting === true };
}
export function writeVeyWorkspace(storage, owner, value, now = Date.now()) {
  try { storage.setItem(storageName(VEY_WORKSPACE_STORAGE, owner), JSON.stringify({ version: 1, owner, at: now, open: value.open === true, chatting: value.chatting === true })); } catch { /* Optional browser storage. */ }
}
