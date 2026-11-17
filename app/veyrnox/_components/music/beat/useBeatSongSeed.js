'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import { beatErrorMessage, beatFailure } from '../../../_lib/music/beat/beatErrors.mjs';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredUserId } from '../../../../lib/authClient.js';
import { gatewayFetch } from '../../../_lib/gateway.js';
import { createBeat, validBeatId } from '../../../_lib/music/beat/beatDocument.mjs';
import { addAudioRegion } from '../../../_lib/music/beat/beatOps.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';
export async function seedSongBeat(songId, cloud) {
  if (!navigator.onLine) throw beatFailure('recovery-r35');
  if (!validBeatId(songId)) throw beatFailure('recovery-r34');
  const userId = getStoredUserId();
  let song;
  try { song = await gatewayFetch(`/music/songs/${encodeURIComponent(songId)}`); }
  catch (e) {
    if ([403, 404].includes(e.status)) throw beatFailure('recovery-r34');
    if (e.status === 401) throw beatFailure('recovery-r36');
    throw beatFailure('recovery-r35');
  }
  const { loadSong } = await import('../../../_lib/music/beat/beatSongAsset.js');
  const { asset } = await loadSong({ source: 'song', ref: { songId: song.id, versionId: song.version_id, jobId: song.job_id },
    name: song.title.slice(0, 80), bpm: null });
  if (!userId || getStoredUserId() !== userId) throw beatFailure('recovery-r36');
  let doc = createBeat({ id: crypto.randomUUID(), title: song.title.normalize('NFKC').trim().slice(0, 80) || 'My song' });
  doc.tracks = [{ id: 't1', name: asset.name.slice(0, 40), kind: 'audio', mute: false, solo: false, gain: 1, pan: 0, regions: [] }];
  doc = addAudioRegion(doc, asset, 't1', 0);
  const result = await store.createBeat(doc, cloud ? { userId, projectId: null, revision: 0, syncedUpdatedAt: 0 } : undefined);
  if (result.error) throw result.error === 'limit' ? beatFailure('device-limit') : beatFailure('recovery-r37');
  return doc.id;
}
export function useBeatSongSeed(songId, cloud) {
  const { t } = useI18n();
  const router = useRouter(), pending = useRef(null);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    // Strict Mode replays effects: share one creation promise so it cannot create two projects.
    pending.current ||= seedSongBeat(songId, cloud);
    pending.current.then(id => { if (active) router.replace(`/app/music/beats/${id}`); }, e => { if (active) setError(beatErrorMessage(e, 'seed', t)); });
    return () => { active = false; };
  }, [songId, cloud, router, attempt, t]);
  return { error, retry: () => { pending.current = null; setError(''); setAttempt(n => n + 1); } };
}
