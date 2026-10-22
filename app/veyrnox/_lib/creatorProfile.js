'use client';

// The Vibe Check in the browser (ADR-0251, routes /api/v1/creator-profile). The server answers 404 while its own
// CREATOR_PROFILE_ENABLED is off; every read failure means "unavailable", and the page then offers nothing, because the
// product is complete without the interview.
import { useCallback, useEffect, useState } from 'react';
import { getSession } from '../../lib/authClient.js';
import { gatewayFetch } from './gateway.js';
import { CREATOR_ANSWERS, cleanCreatorAnswers } from '../../../lib/creatorProfile.js';

export { CREATOR_ANSWERS };

const unavailable = { status: 'unavailable', answers: null };

/** Maps the server's GET body to { status, answers }. Anything unreadable is "unavailable". */
export function readVibe(body) {
  if (!body || typeof body !== 'object') return unavailable;
  if (body.status === 'none') return { status: 'none', answers: null };
  if (body.status === 'skipped') return { status: 'skipped', answers: null };
  if (body.status === 'completed') {
    const clean = cleanCreatorAnswers(body.answers);
    return clean.ok ? { status: 'completed', answers: clean.answers } : unavailable;
  }
  return unavailable;
}

/** The person's stored vibe. Signed out: unavailable, without opening the sign-in dialog. */
export async function fetchVibe() {
  if (!getSession()) return unavailable;
  try {
    return readVibe(await gatewayFetch('/creator-profile'));
  } catch {
    return unavailable;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Each write answers { ok: true } | { ok: false, code } where code is 'unavailable' (flag off) or 'failed'.
async function write(path, init) {
  try {
    await gatewayFetch(path, init);
    return { ok: true };
  } catch (err) {
    return { ok: false, code: err && err.status === 404 ? 'unavailable' : 'failed' };
  }
}

export const saveVibe = (answers) => write('/creator-profile', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(answers) });
export const skipVibe = () => write('/creator-profile/skip', { method: 'POST' });
export const resetVibe = () => write('/creator-profile', { method: 'DELETE' });

/** { status: 'loading' | 'unavailable' | 'none' | 'skipped' | 'completed', answers, reload } */
export function useVibe() {
  const [state, setState] = useState({ status: 'loading', answers: null });
  const reload = useCallback(async () => setState(await fetchVibe()), []);
  useEffect(() => {
    let live = true;
    fetchVibe().then((next) => { if (live) setState(next); });
    return () => { live = false; };
  }, []);
  return { ...state, reload };
}
