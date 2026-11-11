'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  advanceMusicState,
  cancelMusicCandidate,
  commitMusicPreview,
  createMusicRequest,
  findMusicSong,
  musicRows,
  quoteMusicRequest,
  MUSIC_STORE_KEY,
  newMusicPreviewState,
  parseMusicPreviewState,
  resetMusicPreview,
  subscribeMusicPreview,
} from '../../_lib/music/previewStore';

let cachedRaw;
let cachedState;

function musicSnapshot() {
  try {
    const raw = window.localStorage.getItem(MUSIC_STORE_KEY);
    if (cachedState !== undefined && raw === cachedRaw) return cachedState;
    cachedRaw = raw;
    cachedState = parseMusicPreviewState(raw);
    return cachedState;
  } catch {
    if (cachedState === undefined) cachedState = newMusicPreviewState();
    return cachedState;
  }
}

export function useMusicPreviewState() {
  const [state, setState] = useState(null);
  const [storageError, setStorageError] = useState('');

  useEffect(() => {
    const sync = () => {
      try {
        setState(musicSnapshot());
        setStorageError('');
      } catch {
        setStorageError('Progress could not be read from this browser.');
      }
    };
    sync();
    return subscribeMusicPreview(sync);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      try {
        const current = musicSnapshot();
        const next = advanceMusicState(current);
        if (next !== current) {
          commitMusicPreview(next);
          setStorageError('');
        }
      } catch {
        setStorageError('Progress could not be saved in this browser.');
      }
    }, 350);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const rows = useMemo(() => state ? musicRows(state) : [], [state]);

  const create = useCallback((input) => {
    const current = musicSnapshot();
    const quote = quoteMusicRequest(input, current);
    if (!quote) throw new Error('Describe the sound before creating.');
    const result = createMusicRequest(current, {
      ...input,
      quoteId: quote.id,
      idempotencyKey: globalThis.crypto?.randomUUID?.() || `music-${Date.now()}`,
    });
    commitMusicPreview(result.state);
    return result.request;
  }, []);

  const cancel = useCallback((candidateId) => {
    const current = musicSnapshot();
    commitMusicPreview(cancelMusicCandidate(current, candidateId));
  }, []);

  const reset = useCallback(() => resetMusicPreview(), []);
  const find = useCallback((id) => state ? findMusicSong(state, id) : null, [state]);

  return { state, rows, storageError, create, cancel, reset, find };
}
