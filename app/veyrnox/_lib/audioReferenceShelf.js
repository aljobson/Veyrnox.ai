import { TALKING_PHOTO_MODEL_CONTRACTS, VIDEO_LIP_SYNC_MODEL_CONTRACTS } from './performanceStudio.js';
import { normalizeVoicePaletteSettings } from './voicePalettes.js';

const PREFIX = 'veyrnox.audio-reference-shelf.v1:';
const SIGNATURE_PREFIX = 'veyrnox.signature-voice-recipes.v1:';
const PINNED_PREFIX = 'veyrnox.audio-reference-pins.v1:';
const LISTENING_SET_PREFIX = 'veyrnox.audio-listening-sets.v1:';
const MANIFEST_SCHEMA = 'veyrnox-audio-shelf-manifest';
const JOB_ID = /^[A-Za-z0-9_-]{8,128}$/;
const ITEM_ID = /^audio-ref-[a-z0-9-]{1,80}$/;
const LISTENING_SET_ID = /^listening-set-[a-z0-9-]{1,80}$/;
export const MAX_AUDIO_REFERENCES = 24;
export const MAX_SIGNATURE_VOICE_RECIPES = 3;
export const MAX_AUDIO_COMPARISON = 3;
export const MAX_PINNED_AUDIO_REFERENCES = 6;
export const MAX_AUDIO_REFERENCE_TRAITS = 3;
export const MAX_AUDIO_LISTENING_SETS = 6;
export const AUDIO_REFERENCE_PURPOSES = [
  ['lip-sync-dialogue', 'Lip-sync dialogue'],
  ['narration-presenter', 'Narration / presenter'],
  ['dubbing-localisation', 'Dub / localisation'],
  ['character-performance', 'Character performance'],
  ['cleared-song', 'Cleared song performance'],
  ['timing-rhythm', 'Timing / rhythm reference'],
];
export const AUDIO_REFERENCE_TRAITS = [
  ['calm', 'Calm'],
  ['energetic', 'Energetic'],
  ['intimate', 'Intimate'],
  ['authoritative', 'Authoritative'],
  ['playful', 'Playful'],
  ['dramatic', 'Dramatic'],
  ['rhythmic', 'Rhythmic'],
  ['conversational', 'Conversational'],
];
const PURPOSES = new Set(AUDIO_REFERENCE_PURPOSES.map(([id]) => id));
const TRAITS = new Set(AUDIO_REFERENCE_TRAITS.map(([id]) => id));
const AUDIO_ENGINE_CONTRACTS = [...TALKING_PHOTO_MODEL_CONTRACTS, ...VIDEO_LIP_SYNC_MODEL_CONTRACTS]
  .map(({ id, label, maxSeconds }) => Object.freeze({ id, label, maxSeconds }));

const keyFor = (userId) => typeof userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(userId) ? `${PREFIX}${userId}` : null;
const signatureKeyFor = (userId) => typeof userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(userId) ? `${SIGNATURE_PREFIX}${userId}` : null;
const pinnedKeyFor = (userId) => typeof userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(userId) ? `${PINNED_PREFIX}${userId}` : null;
const listeningSetKeyFor = (userId) => typeof userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(userId) ? `${LISTENING_SET_PREFIX}${userId}` : null;

function cleanName(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64)
    : '';
}

function cleanListeningSetName(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
    : '';
}

export function normalizeAudioReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = typeof value.id === 'string' && ITEM_ID.test(value.id) ? value.id : '';
  const jobId = typeof value.jobId === 'string' && JOB_ID.test(value.jobId) ? value.jobId : '';
  const name = cleanName(value.name);
  const purpose = PURPOSES.has(value.purpose) ? value.purpose : '';
  const traits = Array.isArray(value.traits)
    ? [...new Set(value.traits.filter((trait) => typeof trait === 'string' && TRAITS.has(trait)))].slice(0, MAX_AUDIO_REFERENCE_TRAITS)
    : [];
  const voiceRecipe = normalizeVoicePaletteSettings(value.voiceRecipe);
  return id && jobId && name && purpose ? { id, jobId, name, purpose, ...(traits.length ? { traits } : {}), ...(voiceRecipe ? { voiceRecipe } : {}) } : null;
}

export function readAudioReferenceShelf(storage, userId) {
  const key = keyFor(userId);
  if (!key) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    const jobs = new Set();
    return parsed.flatMap((candidate) => {
      const item = normalizeAudioReference(candidate);
      if (!item || jobs.has(item.jobId)) return [];
      jobs.add(item.jobId);
      return [item];
    }).slice(0, MAX_AUDIO_REFERENCES);
  } catch {
    return [];
  }
}

export function readAudioVoiceRecipes(storage, userId) {
  return readAudioReferenceShelf(storage, userId).filter((item) => item.voiceRecipe);
}

export function filterAudioReferences(items, { query = '', purpose = 'all', trait = 'all', voiceRecipesOnly = false, pinnedOnly = false, pinnedIds = [], healthById = {}, healthStatus = 'all' } = {}) {
  if (!Array.isArray(items)) return [];
  const needle = typeof query === 'string' ? query.trim().toLowerCase().slice(0, 64) : '';
  const purposeId = purpose === 'all' || PURPOSES.has(purpose) ? purpose : 'all';
  const traitId = trait === 'all' || TRAITS.has(trait) ? trait : 'all';
  const healthFilter = ['all', 'available', 'unavailable', 'unchecked'].includes(healthStatus) ? healthStatus : 'all';
  const pins = new Set(Array.isArray(pinnedIds) ? pinnedIds.filter((id) => typeof id === 'string' && ITEM_ID.test(id)).slice(0, MAX_PINNED_AUDIO_REFERENCES) : []);
  return items.filter((item) => {
    const normalized = normalizeAudioReference(item);
    if (!normalized) return false;
    if (purposeId !== 'all' && normalized.purpose !== purposeId) return false;
    if (traitId !== 'all' && !normalized.traits?.includes(traitId)) return false;
    if (voiceRecipesOnly && !normalized.voiceRecipe) return false;
    if (pinnedOnly && !pins.has(normalized.id)) return false;
    const itemHealth = healthById && typeof healthById === 'object' && ['available', 'unavailable'].includes(healthById[normalized.id]) ? healthById[normalized.id] : 'unchecked';
    if (healthFilter !== 'all' && itemHealth !== healthFilter) return false;
    if (!needle) return true;
    const label = AUDIO_REFERENCE_PURPOSES.find(([id]) => id === normalized.purpose)?.[1] || '';
    const traitLabels = (normalized.traits || []).map((id) => AUDIO_REFERENCE_TRAITS.find(([value]) => value === id)?.[1] || '').join(' ');
    return `${normalized.name} ${label} ${traitLabels}`.toLowerCase().includes(needle);
  });
}

export function sortAudioReferences(items, { sortBy = 'recent', healthById = {} } = {}) {
  if (!Array.isArray(items)) return [];
  const mode = ['recent', 'name', 'purpose', 'health'].includes(sortBy) ? sortBy : 'recent';
  const rows = items.flatMap((candidate, index) => {
    const item = normalizeAudioReference(candidate);
    return item ? [{ item, index }] : [];
  });
  if (mode === 'recent') return rows.map(({ item }) => item);
  const healthRank = { unavailable: 0, unchecked: 1, available: 2 };
  rows.sort((left, right) => {
    let result = 0;
    if (mode === 'name') result = left.item.name.localeCompare(right.item.name, undefined, { sensitivity: 'base' });
    if (mode === 'purpose') {
      const leftPurpose = AUDIO_REFERENCE_PURPOSES.find(([id]) => id === left.item.purpose)?.[1] || left.item.purpose;
      const rightPurpose = AUDIO_REFERENCE_PURPOSES.find(([id]) => id === right.item.purpose)?.[1] || right.item.purpose;
      result = leftPurpose.localeCompare(rightPurpose, undefined, { sensitivity: 'base' })
        || left.item.name.localeCompare(right.item.name, undefined, { sensitivity: 'base' });
    }
    if (mode === 'health') {
      const leftHealth = ['available', 'unavailable'].includes(healthById?.[left.item.id]) ? healthById[left.item.id] : 'unchecked';
      const rightHealth = ['available', 'unavailable'].includes(healthById?.[right.item.id]) ? healthById[right.item.id] : 'unchecked';
      result = healthRank[leftHealth] - healthRank[rightHealth]
        || left.item.name.localeCompare(right.item.name, undefined, { sensitivity: 'base' });
    }
    return result || left.index - right.index;
  });
  return rows.map(({ item }) => item);
}

export function toggleAudioComparison(current, itemId) {
  const ids = Array.isArray(current)
    ? current.filter((id, index, values) => typeof id === 'string' && ITEM_ID.test(id) && values.indexOf(id) === index).slice(0, MAX_AUDIO_COMPARISON)
    : [];
  const id = typeof itemId === 'string' && ITEM_ID.test(itemId) ? itemId : '';
  if (!id) return ids;
  if (ids.includes(id)) return ids.filter((value) => value !== id);
  return ids.length < MAX_AUDIO_COMPARISON ? [...ids, id] : ids;
}

export function readAudioListeningSets(storage, userId) {
  const key = listeningSetKeyFor(userId);
  if (!key) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    const available = new Set(readAudioReferenceShelf(storage, userId).map((item) => item.id));
    const seenIds = new Set();
    const seenNames = new Set();
    return parsed.flatMap((candidate) => {
      const id = typeof candidate?.id === 'string' && LISTENING_SET_ID.test(candidate.id) ? candidate.id : '';
      const name = cleanListeningSetName(candidate?.name);
      const nameKey = name.toLowerCase();
      const itemIds = Array.isArray(candidate?.itemIds)
        ? [...new Set(candidate.itemIds.filter((itemId) => typeof itemId === 'string' && ITEM_ID.test(itemId) && available.has(itemId)))].slice(0, MAX_AUDIO_COMPARISON)
        : [];
      if (!id || !name || itemIds.length < 2 || seenIds.has(id) || seenNames.has(nameKey)) return [];
      seenIds.add(id);
      seenNames.add(nameKey);
      return [{ id, name, itemIds }];
    }).slice(0, MAX_AUDIO_LISTENING_SETS);
  } catch {
    return [];
  }
}

export function saveAudioListeningSet(storage, userId, value, id = `listening-set-${Date.now().toString(36)}`) {
  const key = listeningSetKeyFor(userId);
  const current = readAudioListeningSets(storage, userId);
  const setId = typeof value?.id === 'string' && LISTENING_SET_ID.test(value.id) ? value.id : id;
  const name = cleanListeningSetName(value?.name);
  const available = new Set(readAudioReferenceShelf(storage, userId).map((item) => item.id));
  const itemIds = Array.isArray(value?.itemIds)
    ? [...new Set(value.itemIds.filter((itemId) => typeof itemId === 'string' && ITEM_ID.test(itemId) && available.has(itemId)))].slice(0, MAX_AUDIO_COMPARISON)
    : [];
  if (!key || !LISTENING_SET_ID.test(setId) || !name || itemIds.length < 2) return current;
  const existing = current.find((candidate) => candidate.id === setId);
  if (!existing && current.length >= MAX_AUDIO_LISTENING_SETS) return current;
  if (current.some((candidate) => candidate.id !== setId && candidate.name.toLowerCase() === name.toLowerCase())) return current;
  const next = [{ id: setId, name, itemIds }, ...current.filter((candidate) => candidate.id !== setId)].slice(0, MAX_AUDIO_LISTENING_SETS);
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export function removeAudioListeningSet(storage, userId, setId) {
  const key = listeningSetKeyFor(userId);
  const current = readAudioListeningSets(storage, userId);
  if (!key || !LISTENING_SET_ID.test(String(setId || ''))) return current;
  const next = current.filter((candidate) => candidate.id !== setId);
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export function createAudioShelfManifest(storage, userId, exportedAt = new Date().toISOString()) {
  const items = readAudioReferenceShelf(storage, userId);
  const signatures = new Set(readSignatureVoiceRecipeIds(storage, userId));
  const pins = new Set(readPinnedAudioReferenceIds(storage, userId));
  const jobByItemId = new Map(items.map((item) => [item.id, item.jobId]));
  return {
    schema: MANIFEST_SCHEMA,
    version: 1,
    exportedAt,
    items: items.map(({ jobId, name, purpose, traits, voiceRecipe }) => ({ jobId, name, purpose, ...(traits?.length ? { traits } : {}), ...(voiceRecipe ? { voiceRecipe } : {}) })),
    signatureJobIds: items.filter((item) => signatures.has(item.id)).map((item) => item.jobId),
    pinnedJobIds: items.filter((item) => pins.has(item.id)).map((item) => item.jobId),
    listeningSets: readAudioListeningSets(storage, userId).map((set) => ({
      name: set.name,
      jobIds: set.itemIds.map((itemId) => jobByItemId.get(itemId)).filter(Boolean),
    })),
  };
}

export function parseAudioShelfManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schema !== MANIFEST_SCHEMA || value.version !== 1 || !Array.isArray(value.items)) return null;
  const jobs = new Set();
  let rejected = 0;
  const items = value.items.slice(0, MAX_AUDIO_REFERENCES).flatMap((candidate, index) => {
    const item = normalizeAudioReference({ ...candidate, id: `audio-ref-manifest-${index + 1}` });
    if (!item || jobs.has(item.jobId)) {
      rejected += 1;
      return [];
    }
    jobs.add(item.jobId);
    const { jobId, name, purpose, traits, voiceRecipe } = item;
    return [{ jobId, name, purpose, ...(traits?.length ? { traits } : {}), ...(voiceRecipe ? { voiceRecipe } : {}) }];
  });
  rejected += Math.max(0, value.items.length - MAX_AUDIO_REFERENCES);
  const signatureJobIds = Array.isArray(value.signatureJobIds)
    ? [...new Set(value.signatureJobIds.filter((id) => typeof id === 'string' && JOB_ID.test(id)))].slice(0, MAX_SIGNATURE_VOICE_RECIPES)
    : [];
  const pinnedJobIds = Array.isArray(value.pinnedJobIds)
    ? [...new Set(value.pinnedJobIds.filter((id) => typeof id === 'string' && JOB_ID.test(id)))].slice(0, MAX_PINNED_AUDIO_REFERENCES)
    : [];
  const listeningSets = Array.isArray(value.listeningSets)
    ? value.listeningSets.slice(0, MAX_AUDIO_LISTENING_SETS).flatMap((candidate) => {
      const name = cleanListeningSetName(candidate?.name);
      const jobIds = Array.isArray(candidate?.jobIds)
        ? [...new Set(candidate.jobIds.filter((id) => typeof id === 'string' && JOB_ID.test(id)))].slice(0, MAX_AUDIO_COMPARISON)
        : [];
      return name && jobIds.length >= 2 ? [{ name, jobIds }] : [];
    })
    : [];
  return { items, signatureJobIds, pinnedJobIds, listeningSets, rejected };
}

export async function importOwnedAudioShelfManifest(fetcher, storage, userId, value, {
  idFactory = (index) => `audio-ref-import-${Date.now().toString(36)}-${index + 1}`,
  setIdFactory = (index) => `listening-set-import-${Date.now().toString(36)}-${index + 1}`,
} = {}) {
  const manifest = parseAudioShelfManifest(value);
  const key = keyFor(userId);
  if (!manifest || !key || typeof fetcher !== 'function' || typeof idFactory !== 'function' || typeof setIdFactory !== 'function') throw new Error('audio_shelf_manifest_invalid');
  const checked = await Promise.all(manifest.items.map(async (item) => {
    try {
      await fetchOwnedAudioReference(fetcher, item.jobId);
      return item;
    } catch {
      return null;
    }
  }));
  const available = checked.filter(Boolean);
  const existingJobs = new Set(readAudioReferenceShelf(storage, userId).map((item) => item.jobId));
  let imported = 0;
  let existing = 0;
  let capacitySkipped = 0;
  for (let index = available.length - 1; index >= 0; index -= 1) {
    const item = available[index];
    if (existingJobs.has(item.jobId)) {
      existing += 1;
      continue;
    }
    const before = readAudioReferenceShelf(storage, userId).length;
    if (before >= MAX_AUDIO_REFERENCES) {
      capacitySkipped += 1;
      continue;
    }
    const next = saveAudioReference(storage, userId, item, idFactory(index, item));
    if (next.some((candidate) => candidate.jobId === item.jobId) && next.length >= before) {
      existingJobs.add(item.jobId);
      imported += 1;
    }
  }
  const items = readAudioReferenceShelf(storage, userId);
  let signatures = readSignatureVoiceRecipeIds(storage, userId);
  for (const jobId of manifest.signatureJobIds) {
    if (signatures.length >= MAX_SIGNATURE_VOICE_RECIPES) break;
    const item = items.find((candidate) => candidate.jobId === jobId && candidate.voiceRecipe);
    if (item && !signatures.includes(item.id)) signatures = toggleSignatureVoiceRecipe(storage, userId, item.id);
  }
  let pins = readPinnedAudioReferenceIds(storage, userId);
  for (const jobId of manifest.pinnedJobIds) {
    if (pins.length >= MAX_PINNED_AUDIO_REFERENCES) break;
    const item = items.find((candidate) => candidate.jobId === jobId);
    if (item && !pins.includes(item.id)) pins = togglePinnedAudioReference(storage, userId, item.id);
  }
  let listeningSets = readAudioListeningSets(storage, userId);
  const itemByJobId = new Map(items.map((item) => [item.jobId, item.id]));
  for (let index = 0; index < manifest.listeningSets.length; index += 1) {
    if (listeningSets.length >= MAX_AUDIO_LISTENING_SETS) break;
    const candidate = manifest.listeningSets[index];
    if (listeningSets.some((set) => set.name.toLowerCase() === candidate.name.toLowerCase())) continue;
    const itemIds = candidate.jobIds.map((jobId) => itemByJobId.get(jobId)).filter(Boolean);
    listeningSets = saveAudioListeningSet(storage, userId, { name: candidate.name, itemIds }, setIdFactory(index, candidate));
  }
  return {
    items,
    signatures,
    pins,
    listeningSets,
    imported,
    unavailable: manifest.items.length - available.length,
    rejected: manifest.rejected,
    existing,
    capacitySkipped,
  };
}

export function readPinnedAudioReferenceIds(storage, userId) {
  const key = pinnedKeyFor(userId);
  if (!key) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    const available = new Set(readAudioReferenceShelf(storage, userId).map((item) => item.id));
    const seen = new Set();
    return parsed.flatMap((value) => {
      const id = typeof value === 'string' && ITEM_ID.test(value) ? value : '';
      if (!id || !available.has(id) || seen.has(id)) return [];
      seen.add(id);
      return [id];
    }).slice(0, MAX_PINNED_AUDIO_REFERENCES);
  } catch {
    return [];
  }
}

export function togglePinnedAudioReference(storage, userId, itemId) {
  const key = pinnedKeyFor(userId);
  const current = readPinnedAudioReferenceIds(storage, userId);
  if (!key || !ITEM_ID.test(String(itemId || ''))) return current;
  const available = readAudioReferenceShelf(storage, userId).some((item) => item.id === itemId);
  if (!available) return current;
  if (!current.includes(itemId) && current.length >= MAX_PINNED_AUDIO_REFERENCES) return current;
  const next = current.includes(itemId)
    ? current.filter((id) => id !== itemId)
    : [itemId, ...current];
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export async function auditOwnedAudioReferences(fetcher, items) {
  if (typeof fetcher !== 'function' || !Array.isArray(items)) return [];
  const seen = new Set();
  const candidates = items.flatMap((candidate) => {
    const item = normalizeAudioReference(candidate);
    if (!item || seen.has(item.id)) return [];
    seen.add(item.id);
    return [item];
  }).slice(0, MAX_AUDIO_REFERENCES);
  return Promise.all(candidates.map(async (item) => {
    try {
      await fetchOwnedAudioReference(fetcher, item.jobId);
      return { itemId: item.id, jobId: item.jobId, status: 'available' };
    } catch {
      return { itemId: item.id, jobId: item.jobId, status: 'unavailable' };
    }
  }));
}

export async function loadOwnedAudioComparison(fetcher, items, durationReader = readAudioDuration) {
  if (typeof fetcher !== 'function' || !Array.isArray(items) || typeof durationReader !== 'function') return [];
  const seen = new Set();
  const candidates = items.flatMap((candidate) => {
    const item = normalizeAudioReference(candidate);
    if (!item || seen.has(item.id)) return [];
    seen.add(item.id);
    return [item];
  }).slice(0, MAX_AUDIO_COMPARISON);
  return Promise.all(candidates.map(async (item) => {
    try {
      const owned = await fetchOwnedAudioReference(fetcher, item.jobId);
      let duration = null;
      try {
        const measured = Number(await durationReader(owned.url));
        if (Number.isFinite(measured) && measured > 0) duration = measured;
      } catch { /* playback remains available when metadata cannot be measured */ }
      return {
        itemId: item.id,
        name: item.name,
        url: owned.url,
        available: true,
        duration,
        engines: audioEngineFit(duration),
      };
    } catch {
      return { itemId: item.id, name: item.name, available: false, duration: null, engines: [] };
    }
  }));
}

export function readSignatureVoiceRecipeIds(storage, userId) {
  const key = signatureKeyFor(userId);
  if (!key) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    const available = new Set(readAudioVoiceRecipes(storage, userId).map((item) => item.id));
    const seen = new Set();
    return parsed.flatMap((value) => {
      const id = typeof value === 'string' && ITEM_ID.test(value) ? value : '';
      if (!id || !available.has(id) || seen.has(id)) return [];
      seen.add(id);
      return [id];
    }).slice(0, MAX_SIGNATURE_VOICE_RECIPES);
  } catch {
    return [];
  }
}

export function toggleSignatureVoiceRecipe(storage, userId, itemId) {
  const key = signatureKeyFor(userId);
  const current = readSignatureVoiceRecipeIds(storage, userId);
  if (!key || !ITEM_ID.test(String(itemId || ''))) return current;
  const available = readAudioVoiceRecipes(storage, userId).some((item) => item.id === itemId);
  if (!available) return current;
  if (!current.includes(itemId) && current.length >= MAX_SIGNATURE_VOICE_RECIPES) return current;
  const next = current.includes(itemId)
    ? current.filter((id) => id !== itemId)
    : [itemId, ...current];
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export function saveAudioReference(storage, userId, value, id = `audio-ref-${Date.now().toString(36)}`) {
  const current = readAudioReferenceShelf(storage, userId);
  const existing = current.find((item) => item.jobId === value?.jobId);
  const item = normalizeAudioReference({ ...value, voiceRecipe: value?.voiceRecipe ?? existing?.voiceRecipe, id: existing?.id || id });
  const key = keyFor(userId);
  if (!key || !item) return current;
  const next = [item, ...current.filter((candidate) => candidate.jobId !== item.jobId)].slice(0, MAX_AUDIO_REFERENCES);
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export function removeAudioReference(storage, userId, itemId) {
  const current = readAudioReferenceShelf(storage, userId);
  const key = keyFor(userId);
  if (!key || !ITEM_ID.test(String(itemId || ''))) return current;
  const next = current.filter((item) => item.id !== itemId);
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export function updateAudioReferenceMetadata(storage, userId, itemId, value) {
  const current = readAudioReferenceShelf(storage, userId);
  const key = keyFor(userId);
  if (!key || !ITEM_ID.test(String(itemId || ''))) return current;
  const existing = current.find((item) => item.id === itemId);
  if (!existing) return current;
  const updated = normalizeAudioReference({
    ...existing,
    name: value?.name,
    purpose: value?.purpose,
    traits: value?.traits ?? existing.traits,
  });
  if (!updated) return current;
  const next = current.map((item) => item.id === itemId ? updated : item);
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export async function fetchOwnedAudioReference(fetcher, jobId) {
  if (typeof fetcher !== 'function' || typeof jobId !== 'string' || !JOB_ID.test(jobId)) throw new Error('audio_reference_invalid');
  const job = await fetcher(`/jobs/${jobId}`);
  if (job?.state !== 'succeeded') throw new Error('audio_reference_not_ready');
  const asset = await fetcher(`/jobs/${jobId}/asset`);
  if (!String(asset?.mime_type || '').startsWith('audio/')) throw new Error('audio_reference_not_audio');
  if (typeof asset?.url !== 'string' || !asset.url.startsWith('https://')) throw new Error('audio_reference_url_invalid');
  return { id: jobId, url: asset.url, label: job.label || 'Audio reference' };
}

export function audioEngineFit(seconds) {
  const duration = Number(seconds);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  return AUDIO_ENGINE_CONTRACTS.map((engine) => ({
    ...engine,
    fits: duration <= engine.maxSeconds,
    overBy: Math.round(Math.max(0, duration - engine.maxSeconds) * 10) / 10,
  }));
}

export function readAudioDuration(url, { audioFactory = () => new Audio(), timeoutMs = 8000 } = {}) {
  if (typeof url !== 'string' || !url.startsWith('https://') || typeof audioFactory !== 'function') {
    return Promise.reject(new Error('audio_duration_invalid'));
  }
  const timeout = Number.isFinite(timeoutMs) ? Math.max(250, Math.min(15000, timeoutMs)) : 8000;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let audio;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (audio) {
        audio.onloadedmetadata = null;
        audio.onerror = null;
        try {
          audio.removeAttribute?.('src');
          audio.load?.();
        } catch { /* disposal must not replace the measured result */ }
      }
      handler(value);
    };
    try {
      audio = audioFactory();
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const duration = Number(audio.duration);
        if (Number.isFinite(duration) && duration > 0) finish(resolve, duration);
        else finish(reject, new Error('audio_duration_unknown'));
      };
      audio.onerror = () => finish(reject, new Error('audio_duration_unavailable'));
      timer = setTimeout(() => finish(reject, new Error('audio_duration_timeout')), timeout);
      audio.src = url;
    } catch {
      finish(reject, new Error('audio_duration_unavailable'));
    }
  });
}
