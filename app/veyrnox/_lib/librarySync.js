'use client';

// Library favourites and the unsent Create draft on the server (ADR-0340, routes /api/v1/library-sync). The server
// answers 404 while its own LIBRARY_SYNC_ENABLED is off, and a signed-out or offline browser has no account to ask, so
// every failure means "unavailable" and the page keeps working from this browser's own copy. Nothing here ever blocks the
// page or throws. Nothing is logged: a draft holds the person's prompt.
import { getSession } from '../../lib/authClient.js';
import { gatewayFetch } from './gateway.js';
import { readSyncBody } from '../../../lib/librarySync.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** { kind: 'ok', favourites, draft, draftUpdatedAt } | { kind: 'unavailable' }. Signed out: unavailable, without opening the sign-in dialog. */
export async function fetchLibrarySync(fetcher = gatewayFetch, session = getSession) {
  if (!session()) return { kind: 'unavailable' };
  try {
    return { kind: 'ok', ...readSyncBody(await fetcher('/library-sync')) };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Best effort and safe to repeat. Resolves true when the server holds the change. */
export async function pushFavourite(jobId, starred, fetcher = gatewayFetch, session = getSession) {
  if (!session()) return false;
  try {
    await fetcher('/library-sync/favourites', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ job_id: jobId, starred }) });
    return true;
  } catch {
    return false;
  }
}

/** Replace the account's draft with the shared words and settings (toSharedDraft). */
export async function pushDraft(draft, fetcher = gatewayFetch, session = getSession) {
  if (!session()) return false;
  try {
    await fetcher('/library-sync/draft', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ draft }) });
    return true;
  } catch {
    return false;
  }
}

export async function clearRemoteDraft(fetcher = gatewayFetch, session = getSession) {
  if (!session()) return false;
  try {
    await fetcher('/library-sync/draft', { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}
