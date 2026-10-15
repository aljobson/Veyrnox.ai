'use client';
import { cleanJourney, JOURNEY_KEY } from '../../../lib/veyJourney';
import { getStoredUserId } from '../../lib/authClient';

let task = null;
let view = {};
let current = { task, view };
let owner;
const listeners = new Set();
export const subscribeJourney = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getJourney = () => current;
export const journeyStore = { getState: getJourney, subscribe: subscribeJourney };
const emit = () => { current = { task, view }; listeners.forEach((fn) => fn()); };
export function initialiseJourney() {
  const nextOwner = getStoredUserId() || 'signed-out';
  if (owner === nextOwner) return;
  if (owner !== undefined) view = {};
  owner = nextOwner;
  try { task = cleanJourney(JSON.parse(sessionStorage.getItem(JOURNEY_KEY)), owner); } catch { task = null; }
  emit();
}
export function updateJourney(patch) {
  initialiseJourney();
  task = patch === null ? null : { ...task, ...patch, owner, updatedAt: Date.now() };
  try { if (task) sessionStorage.setItem(JOURNEY_KEY, JSON.stringify(task)); else sessionStorage.removeItem(JOURNEY_KEY); } catch { /* In-memory guidance still works. */ }
  emit();
}
export function publishJourneyView(patch) { view = { ...view, ...patch }; emit(); }
export function beginJourney(passportId = null) {
  updateJourney({ phase: passportId ? 'image' : 'video', passportId, handedOff: false, imageId: null, imageJob: null, videoJob: null, reviewed: {} });
}
export function journeyHandoff(passportId) {
  if (task?.phase === 'image' && task.passportId === passportId) {
    publishJourneyView({ handedOff: true });
    // Only the identity of the handoff is persisted, never the character data.
    updateJourney({ handedOff: true });
  }
}
export function trackJourneyJob(jobId, kind, submittedTask) {
  if (task !== submittedTask) return;
  if (task?.phase === kind && (kind === 'video' || task.handedOff)) updateJourney({ [kind === 'video' ? 'videoJob' : 'imageJob']: jobId });
}
export function journeyStamp(value) {
  // Local comparison token, not a security digest. Never stored as prompt text.
  let hash = 2166136261;
  for (const c of JSON.stringify(value)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return String(hash >>> 0);
}
