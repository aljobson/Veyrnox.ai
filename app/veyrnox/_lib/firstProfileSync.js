'use client';

// First-run answers (ADR-0339) on this device and on the account. The server answers 404 while FIRST_GOAL_SYNC_ENABLED is
// off and a signed-out browser has no account to ask, so every failure means "unavailable" and the device copy decides.
// Nothing here ever blocks a page or throws.
import { getSession } from '../../lib/authClient.js';
import { gatewayFetch } from './gateway.js';
import { FIRST_GOAL_SLOT, parseFirstGoal, readRemoteFirstGoal, serializeFirstGoal } from './firstGoal.js';
import { FIRST_PROFILE_SLOT, parseFirstProfile, readRemoteFirstProfile, serializeFirstProfile } from './firstProfile.js';

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

/** { kind: 'answers', goal, role, destination } | { kind: 'unavailable' }. Signed out: unavailable, without opening the sign-in dialog. */
export async function fetchRemoteAnswers(fetcher = gatewayFetch, session = getSession) {
  if (!session()) return { kind: 'unavailable' };
  try {
    const body = await fetcher('/first-goal');
    const profile = readRemoteFirstProfile(body);
    const goal = readRemoteFirstGoal(body);
    if (profile.kind !== 'profile' || goal.kind === 'unavailable') return { kind: 'unavailable' };
    return { kind: 'answers', goal: goal.kind === 'goal' ? goal.goal : null, role: profile.role, destination: profile.destination };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Best effort and safe to repeat: the server never lowers an answer and treats the same words again as a replay. */
export async function pushAnswers(answers, fetcher = gatewayFetch, session = getSession) {
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
