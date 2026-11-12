'use client';

// The first-goal answer on the server (ADR-0336, routes /api/v1/first-goal). The server answers 404 while its own
// FIRST_GOAL_SYNC_ENABLED is off, and a signed-out or offline browser has no account to ask, so every failure means
// "unavailable" and the card falls back to this browser's own copy. Nothing here ever blocks the page.
import { getSession } from '../../lib/authClient.js';
import { gatewayFetch } from './gateway.js';
import { readRemoteFirstGoal } from './firstGoal.js';

/** { kind: 'goal', goal } | { kind: 'none' } | { kind: 'unavailable' }. Signed out: unavailable, without opening the sign-in dialog. */
export async function fetchRemoteFirstGoal(fetcher = gatewayFetch, session = getSession) {
  if (!session()) return { kind: 'unavailable' };
  try {
    return readRemoteFirstGoal(await fetcher('/first-goal'));
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Best effort and safe to repeat: the server never lowers an answer and treats the same word again as a replay. */
export async function pushFirstGoal(goal, fetcher = gatewayFetch, session = getSession) {
  if (!session()) return;
  try {
    await fetcher('/first-goal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal }) });
  } catch { /* the device copy still holds the answer */ }
}
