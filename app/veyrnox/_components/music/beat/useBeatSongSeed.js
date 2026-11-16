'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredUserId } from '../../../../lib/authClient.js';
import { gatewayFetch } from '../../../_lib/gateway.js';
import { createBeat, validBeatId } from '../../../_lib/music/beat/beatDocument.mjs';
import { addAudioRegion } from '../../../_lib/music/beat/beatOps.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';
const unavailable = 'This song belongs to another account or was deleted';
export async function seedSongBeat(songId, cloud) {
  if (!navigator.onLine) throw new Error('Opening a song in Beats needs a connection. Connect and try again.');
  if (!validBeatId(songId)) throw new Error(unavailable);
  const userId = getStoredUserId();
  let song;
  try { song = await gatewayFetch(`/music/songs/${encodeURIComponent(songId)}`); }
  catch (e) {
    if ([403, 404].includes(e.status)) throw new Error(unavailable);
    if (e.status === 401) throw new Error('Sign in again to open this song in Beats.');
    throw new Error('Opening a song in Beats needs a connection. Connect and try again.');
  }
  const { loadSong } = await import('../../../_lib/music/beat/beatSongAsset.js');
  const { asset } = await loadSong({ source: 'song', ref: { songId: song.id, versionId: song.version_id, jobId: song.job_id },
    name: song.title.slice(0, 80), bpm: null });
  if (!userId || getStoredUserId() !== userId) throw new Error('Sign in again to open this song in Beats.');
  let doc = createBeat({ id: crypto.randomUUID(), title: song.title.normalize('NFKC').trim().slice(0, 80) || 'My song' });
  doc.tracks = [{ id: 't1', name: asset.name.slice(0, 40), kind: 'audio', mute: false, solo: false, gain: 1, pan: 0, regions: [] }];
  doc = addAudioRegion(doc, asset, 't1', 0);
  const result = await store.createBeat(doc, cloud ? { userId, projectId: null, revision: 0, syncedUpdatedAt: 0 } : undefined);
  if (result.error) throw new Error(result.error === 'limit' ? 'This device has 50 beats. Delete one to make room.' : 'Could not save this beat on this device. Try again.');
  return doc.id;
}
export function useBeatSongSeed(songId, cloud) {
  const router = useRouter(), pending = useRef(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    // Strict Mode replays effects: share one creation promise so it cannot create two projects.
    pending.current ||= seedSongBeat(songId, cloud);
    pending.current.then(id => { if (active) router.replace(`/app/music/beats/${id}`); }, e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [songId, cloud, router, attempt]);
  return { error, retry: () => { pending.current = null; setError(''); setAttempt(n => n + 1); } };
}
