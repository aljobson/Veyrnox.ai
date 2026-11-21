'use client';

// First-run answers (ADR-0339) on this device and on the account. The server answers 404 while FIRST_GOAL_SYNC_ENABLED is
// off and a signed-out browser has no account to ask, so every failure means "unavailable" and the device copy decides.
// Nothing here ever blocks a page or throws.
import { getStoredSession, getStoredUserId } from '../../lib/authClient.js';
import { gatewayFetch } from './gateway.js';
import { FIRST_GOAL_SLOT, parseFirstGoal, readRemoteFirstGoal, serializeFirstGoal } from './firstGoal.js';
import { FIRST_ONBOARDING_SLOT, FIRST_PROFILE_SLOT, parseFirstOnboarding, parseFirstProfile, readRemoteFirstOnboarding, readRemoteFirstProfile, serializeFirstOnboarding, serializeFirstProfile } from './firstProfile.js';

/** { goal, role, destination } from this browser; a missing or unreadable copy is null. */
export function readDeviceAnswers(storage) {
  try {
    const slot = storage ?? window.localStorage;
    const goal = parseFirstGoal(slot.getItem(FIRST_GOAL_SLOT))?.goal ?? null;
    return { goal, ...parseFirstProfile(slot.getItem(FIRST_PROFILE_SLOT)) };
  } catch {
    return { goal: null, role: null, destination: null };
  }
}

// A real word on this device is never replaced by "skipped" (the server keeps the same rule).
const keep = (old, next) => (next === null ? old : next === 'skipped' && old ? old : next);

/** Writes any of goal / role / destination to this browser. Returns what the device now holds. */
export function saveDeviceAnswers(answers, storage) {
  const now = readDeviceAnswers(storage);
  const merged = { goal: keep(now.goal, answers.goal ?? null), role: keep(now.role, answers.role ?? null), destination: keep(now.destination, answers.destination ?? null) };
  try {
    const slot = storage ?? window.localStorage;
    if (merged.goal) slot.setItem(FIRST_GOAL_SLOT, serializeFirstGoal(merged.goal));
    if (merged.role || merged.destination) slot.setItem(FIRST_PROFILE_SLOT, serializeFirstProfile({ role: merged.role, destination: merged.destination }));
  } catch { /* storage blocked: the questions may be asked once more */ }
  return merged;
}

export function readDeviceOnboarding(owner, storage) {
  try { return parseFirstOnboarding((storage ?? window.localStorage).getItem(FIRST_ONBOARDING_SLOT), owner); }
  catch { return null; }
}

export function saveDeviceOnboarding(owner, state, storage) {
  if (!owner) return;
  try { (storage ?? window.localStorage).setItem(FIRST_ONBOARDING_SLOT, serializeFirstOnboarding(owner, state)); }
  catch { /* account state remains authoritative */ }
}

const remoteOnboarding = (body) => {
  const progress = readRemoteFirstOnboarding(body);
  const profile = readRemoteFirstProfile(body);
  const goal = readRemoteFirstGoal(body);
  if (progress.kind !== 'progress' || profile.kind !== 'profile' || goal.kind === 'unavailable') return null;
  return { goal: goal.kind === 'goal' ? goal.goal : null, role: profile.role, destination: profile.destination,
    version: progress.version, currentStep: progress.currentStep, completed: progress.completed };
};

const transitionBody = (currentStep, answer, completed = false) => ({ version: 1, current_step: currentStep, completed,
  ...(answer === undefined ? {} : { [currentStep]: answer }) });

const samePendingIntent = (left, right) => ['goal', 'destination', 'role', 'currentStep', 'completeRequested']
  .every((key) => (left?.[key] ?? null) === (right?.[key] ?? null));

/** Replay the owner-stamped outbox in canonical order, then reconcile authoritative state after any failure/409. */
export async function replayOnboarding(owner, state, { fetcher = gatewayFetch, currentOwner = getStoredUserId, storage, timeoutMs = 5000 } = {}) {
  if (!owner || currentOwner() !== owner || !state?.pending) return state ?? null;
  // A queued replay may have been superseded while it waited. Always send the newest durable envelope.
  const latestAtStart = readDeviceOnboarding(owner, storage);
  const desired = latestAtStart?.pending ? latestAtStart : state;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => { controller?.abort(); rejectDeadline(new Error('onboarding_sync_timeout')); }, timeoutMs);
  const bounded = (promise) => Promise.race([promise, deadline]);
  const request = (body) => bounded(fetcher('/first-goal', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), ...(controller ? { signal: controller.signal } : {}) }));
  let last = null;
  let failed = false;
  try {
    for (const step of ['goal', 'destination', 'role']) {
      if (typeof desired[step] !== 'string') continue;
      last = await request(transitionBody(step, desired[step]));
      if (currentOwner() !== owner) { if (timer) clearTimeout(timer); return null; }
    }
    if (desired.completeRequested && desired.goal !== 'skipped') {
      last = await request(transitionBody('recap', undefined, true));
      if (currentOwner() !== owner) { if (timer) clearTimeout(timer); return null; }
    }
  } catch { failed = true; }

  if (currentOwner() !== owner) { if (timer) clearTimeout(timer); return null; }
  let authoritative = remoteOnboarding(last);
  if (failed || !authoritative) {
    try { authoritative = remoteOnboarding(await bounded(fetcher('/first-goal', controller ? { signal: controller.signal } : undefined))); }
    catch { /* keep the durable outbox */ }
  }
  if (timer) clearTimeout(timer);
  if (currentOwner() !== owner) return null;
  // Never let an older in-flight acknowledgement erase a newer answer that was persisted while it ran.
  const latest = readDeviceOnboarding(owner, storage);
  if (latest?.pending && !samePendingIntent(latest, desired)) return latest;
  if (authoritative?.completed) {
    const settled = { ...authoritative, pending: false, completeRequested: false };
    saveDeviceOnboarding(owner, settled, storage);
    return settled;
  }
  if (!failed && authoritative && !desired.completeRequested) {
    const settled = { ...authoritative, pending: false, completeRequested: false };
    saveDeviceOnboarding(owner, settled, storage);
    return settled;
  }
  const pending = { ...desired, version: 1, completed: false,
    currentStep: authoritative?.currentStep ?? desired.currentStep ?? 'goal', pending: true };
  saveDeviceOnboarding(owner, pending, storage);
  return pending;
}

let onboardingReplays = Promise.resolve();
export function scheduleOnboardingReplay(owner, state, options) {
  const run = () => replayOnboarding(owner, state, options);
  const result = onboardingReplays.then(run, run);
  onboardingReplays = result.then(() => undefined, () => undefined);
  return result;
}

const DISMISS_SLOT = 'veyrnox.firstOnboarding.dismissed';
export function dismissFirstRun(owner, storage) {
  if (!owner) return;
  try { (storage ?? window.sessionStorage).setItem(DISMISS_SLOT, JSON.stringify({ owner })); } catch { /* remount may show it again */ }
}
export function isFirstRunDismissed(owner, storage) {
  if (!owner) return false;
  try { return JSON.parse((storage ?? window.sessionStorage).getItem(DISMISS_SLOT))?.owner === owner; } catch { return false; }
}

// An account-level gate may fall back only to an envelope stamped for that account. A missing match is unresolved, not
// "complete": the unowned legacy answer slots may contain another account's preferences on a shared browser.
export function readOfflineOnboarding(owner, storage) {
  if (!owner) return { kind: 'signed-out' };
  const state = readDeviceOnboarding(owner, storage);
  return state ? { kind: 'answers', ...state } : { kind: 'unresolved' };
}

/** { kind: 'answers', goal, role, destination } | { kind: 'unavailable' }. Signed out: unavailable, without opening the sign-in dialog. */
// "Signed in" is the stored session, not a live access token: the token is absent or expired for a moment on every page
// load and the gateway refreshes it. Asking for the live token here made a signed-in person look unanswerable and opened the questions.
export async function fetchRemoteAnswers(fetcher = gatewayFetch, session = getStoredSession) {
  if (!session()) return { kind: 'unavailable' };
  try {
    const body = await fetcher('/first-goal');
    const profile = readRemoteFirstProfile(body);
    const goal = readRemoteFirstGoal(body);
    if (profile.kind !== 'profile' || goal.kind === 'unavailable') return { kind: 'unavailable' };
    const progress = readRemoteFirstOnboarding(body);
    return { kind: 'answers', goal: goal.kind === 'goal' ? goal.goal : null, role: profile.role, destination: profile.destination,
      ...(progress.kind === 'progress' ? { version: progress.version, currentStep: progress.currentStep, completed: progress.completed } : {}) };
  } catch {
    return { kind: 'unavailable' };
  }
}

let onboardingPushes = Promise.resolve();
export function pushOnboarding({ currentStep, completed = false, answer }, fetcher = gatewayFetch, owner = getStoredUserId()) {
  const run = async () => {
    if (!owner || getStoredUserId() !== owner) return null;
    const body = { version: 1, current_step: currentStep, completed, ...(answer ? { [currentStep]: answer } : {}) };
    try {
      const result = await fetcher('/first-goal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return getStoredUserId() === owner ? result : null;
    }
    catch { return null; }
  };
  const result = onboardingPushes.then(run, run);
  onboardingPushes = result.then(() => undefined, () => undefined);
  return result;
}

/** Best effort and safe to repeat: the server never lowers an answer and treats the same words again as a replay. */
export async function pushAnswers(answers, fetcher = gatewayFetch, session = getStoredSession) {
  const body = Object.fromEntries(['goal', 'role', 'destination'].filter((key) => typeof answers[key] === 'string').map((key) => [key, answers[key]]));
  if (!session() || Object.keys(body).length === 0) return;
  try {
    await fetcher('/first-goal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { /* the device copy still holds the answers */ }
}

const HANDOFF_SLOT = 'veyrnox.firstRunHandoff';
/** The goal chosen in the first-run flow, for Create to pick up once (a word, in this tab only). */
export function setFirstRunHandoff(goal) {
  try { window.sessionStorage.setItem(HANDOFF_SLOT, goal); } catch { /* Create simply opens as it is */ }
}
export function takeFirstRunHandoff() {
  try {
    const goal = window.sessionStorage.getItem(HANDOFF_SLOT);
    window.sessionStorage.removeItem(HANDOFF_SLOT);
    return goal === 'image' || goal === 'video' || goal === 'audio' ? goal : null;
  } catch {
    return null;
  }
}
