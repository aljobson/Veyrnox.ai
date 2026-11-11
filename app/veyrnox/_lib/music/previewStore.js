export const MUSIC_PREVIEW_FLAG = 'veyrnox_music_preview';
export const MUSIC_STORE_KEY = 'veyrnox_music_preview_v1';
export const MUSIC_STORE_EVENT = 'veyrnox:music-preview';
export const MUSIC_QUOTE_ID = 'music-preview-pair-2x5-v1';
export const MUSIC_CANDIDATE_COST = 5;
export const MUSIC_PAIR_COST = MUSIC_CANDIDATE_COST * 2;

export function newMusicPreviewState() {
  return {
    version: 1,
    credits: 50,
    requests: [],
    ledger: [{ id: 'welcome', amount: 50, reason: 'Preview opening balance' }],
  };
}

function validCandidate(candidate) {
  return candidate && typeof candidate.id === 'string' && typeof candidate.status === 'string';
}

export function parseMusicPreviewState(raw) {
  if (!raw) return newMusicPreviewState();
  const value = JSON.parse(raw);
  if (
    value?.version !== 1 ||
    !Number.isFinite(value.credits) ||
    !Array.isArray(value.requests) ||
    !Array.isArray(value.ledger) ||
    value.requests.some((request) => !Array.isArray(request?.candidates) || request.candidates.some((candidate) => !validCandidate(candidate)))
  ) throw new Error('The saved Music preview is not valid.');
  return value;
}

export function readMusicPreviewState(storage) {
  try {
    return parseMusicPreviewState(storage?.getItem(MUSIC_STORE_KEY));
  } catch {
    return newMusicPreviewState();
  }
}

export function writeMusicPreviewState(storage, state) {
  storage.setItem(MUSIC_STORE_KEY, JSON.stringify(state));
  return state;
}

export function quoteMusicRequest(input, state) {
  const prompt = String(input?.prompt || '').trim();
  if (!prompt) return null;
  return {
    id: MUSIC_QUOTE_ID,
    candidates: 2,
    perCandidate: MUSIC_CANDIDATE_COST,
    total: MUSIC_PAIR_COST,
    balance: state.credits,
    balanceAfter: state.credits - MUSIC_PAIR_COST,
    affordable: state.credits >= MUSIC_PAIR_COST,
  };
}

function cleanTitle(value, prompt) {
  const typed = String(value || '').trim();
  if (typed) return typed.slice(0, 80);
  const words = String(prompt || '').trim().split(/\s+/).slice(0, 5).join(' ');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Untitled sound';
}

export function createMusicRequest(state, input, now = Date.now()) {
  const prompt = String(input?.prompt || '').trim();
  const key = String(input?.idempotencyKey || '').trim();
  if (!prompt) throw new Error('Describe the sound before creating.');
  if (!key) throw new Error('A request key is required.');
  const existing = state.requests.find((request) => request.idempotencyKey === key);
  if (existing) return { state, request: existing, replayed: true };
  if (input?.quoteId !== MUSIC_QUOTE_ID) throw new Error('Refresh the credit quote before creating.');
  if (state.credits < MUSIC_PAIR_COST) throw new Error('You need 10 preview credits for two versions.');

  const id = String(input.requestId || `music-${now.toString(36)}`);
  const title = cleanTitle(input.title, prompt);
  const request = {
    id,
    idempotencyKey: key,
    quoteId: MUSIC_QUOTE_ID,
    createdAt: now,
    title,
    prompt: prompt.slice(0, 3000),
    mode: input.mode === 'custom' ? 'custom' : 'simple',
    styles: String(input.styles || '').trim().slice(0, 500),
    scenario: input.scenario === 'fail-b' ? 'fail-b' : 'success',
    debit: MUSIC_PAIR_COST,
    candidates: ['A', 'B'].map((label) => ({
      id: `${id}-${label.toLowerCase()}`,
      label,
      status: 'queued',
      progress: 4,
      charged: MUSIC_CANDIDATE_COST,
      refunded: false,
      duration: label === 'A' ? 41 : 47,
    })),
  };
  const next = {
    ...state,
    credits: state.credits - MUSIC_PAIR_COST,
    requests: [request, ...state.requests],
    ledger: [
      { id: `${id}-debit`, requestId: id, amount: -MUSIC_PAIR_COST, reason: 'Two-version music preview' },
      ...state.ledger,
    ],
  };
  return { state: next, request, replayed: false };
}

function candidatePhase(label, elapsed, scenario) {
  const marks = label === 'A'
    ? { composing: 500, mastering: 1400, done: 2500 }
    : { composing: 800, mastering: 2200, done: 3900 };
  if (elapsed < marks.composing) return { status: 'queued', progress: 8 };
  if (elapsed < marks.mastering) {
    const progress = 18 + Math.round(((elapsed - marks.composing) / (marks.mastering - marks.composing)) * 34);
    return { status: 'composing', progress };
  }
  if (elapsed < marks.done) {
    const progress = 58 + Math.round(((elapsed - marks.mastering) / (marks.done - marks.mastering)) * 38);
    return { status: 'mastering', progress };
  }
  if (label === 'B' && scenario === 'fail-b') return { status: 'failed', progress: 100 };
  return { status: 'ready', progress: 100 };
}

export function advanceMusicState(state, now = Date.now()) {
  let credits = state.credits;
  let ledger = state.ledger;
  let changed = false;
  const requests = state.requests.map((request) => {
    const elapsed = Math.max(0, now - request.createdAt);
    const candidates = request.candidates.map((candidate) => {
      if (['ready', 'failed', 'cancelled'].includes(candidate.status)) return candidate;
      const phase = candidatePhase(candidate.label, elapsed, request.scenario);
      let next = phase.status === candidate.status && phase.progress === candidate.progress
        ? candidate
        : { ...candidate, ...phase };
      if (phase.status === 'failed' && !candidate.refunded) {
        credits += candidate.charged;
        ledger = [
          { id: `${candidate.id}-refund`, requestId: request.id, candidateId: candidate.id, amount: candidate.charged, reason: `Version ${candidate.label} failed` },
          ...ledger,
        ];
        next = { ...next, refunded: true };
      }
      if (next !== candidate) changed = true;
      return next;
    });
    return candidates === request.candidates ? request : { ...request, candidates };
  });
  return changed ? { ...state, credits, ledger, requests } : state;
}

export function cancelMusicCandidate(state, candidateId) {
  let refund = 0;
  let requestId = '';
  const requests = state.requests.map((request) => {
    const candidates = request.candidates.map((candidate) => {
      if (candidate.id !== candidateId || ['ready', 'failed', 'cancelled'].includes(candidate.status)) return candidate;
      refund = candidate.charged;
      requestId = request.id;
      return { ...candidate, status: 'cancelled', progress: candidate.progress, refunded: true };
    });
    return refund && request.id === requestId ? { ...request, candidates } : request;
  });
  if (!refund) return state;
  return {
    ...state,
    credits: state.credits + refund,
    requests,
    ledger: [
      { id: `${candidateId}-cancel-refund`, requestId, candidateId, amount: refund, reason: 'Cancelled before completion' },
      ...state.ledger,
    ],
  };
}

export function musicRows(state) {
  return state.requests.flatMap((request) => request.candidates.map((candidate) => ({
    ...candidate,
    requestId: request.id,
    title: request.title,
    prompt: request.prompt,
    styles: request.styles,
    mode: request.mode,
    createdAt: request.createdAt,
  })));
}

export function findMusicSong(state, id) {
  return musicRows(state).find((song) => song.id === id) || null;
}

export function subscribeMusicPreview(onChange) {
  const notify = () => onChange();
  window.addEventListener('storage', notify);
  window.addEventListener(MUSIC_STORE_EVENT, notify);
  return () => {
    window.removeEventListener('storage', notify);
    window.removeEventListener(MUSIC_STORE_EVENT, notify);
  };
}

export function commitMusicPreview(state, storage = window.localStorage) {
  writeMusicPreviewState(storage, state);
  window.dispatchEvent(new Event(MUSIC_STORE_EVENT));
  return state;
}

export function resetMusicPreview(storage = window.localStorage) {
  storage.removeItem(MUSIC_STORE_KEY);
  window.dispatchEvent(new Event(MUSIC_STORE_EVENT));
}
