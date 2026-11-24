'use client';

import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { gatewayFetch } from './gateway';
import { claimAudioFocus, releaseAudioFocus } from './audioFocus';

// A private Music version's audio_url is the account-checked JSON route
// /api/v1/jobs/:id/asset. That route needs the Bearer token, which an <audio>
// element cannot send, and it answers with { url } rather than audio, so using it
// as a src never played. This asks the route for the short-lived signed URL and
// hands that to the player instead.

const PRIVATE_ASSET = /^\/api\/v1(\/jobs\/[0-9a-f-]{36}\/asset)$/i;

/** The gateway path to sign for a private Music audio_url, or null when it is already playable. */
export function privateMusicAssetPath(audioUrl) {
  const match = typeof audioUrl === 'string' ? PRIVATE_ASSET.exec(audioUrl) : null;
  return match ? match[1] : null;
}

// A signed URL lasts 15 minutes. When the player reports an error (for example an
// expired link after the page sat open), sign again, at most once every 30 seconds.
const RESIGN_AFTER_MS = 30_000;

/** @param {string | null | undefined} audioUrl  @returns {{ url: string | undefined, refresh: () => void }} */
export function useMusicAudioSrc(audioUrl) {
  const path = privateMusicAssetPath(audioUrl);
  const [signed, setSigned] = useState({ path: null, url: undefined, at: 0 });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    gatewayFetch(path)
      .then((asset) => { if (live && typeof asset?.url === 'string') setSigned({ path, url: asset.url, at: Date.now() }); })
      .catch(() => { if (live) setSigned({ path, url: undefined, at: Date.now() }); });
    return () => { live = false; };
  }, [path, attempt]);
  const refresh = () => { if (path && Date.now() - signed.at >= RESIGN_AFTER_MS) setAttempt((n) => n + 1); };
  if (!audioUrl) return { url: undefined, refresh };
  if (!path) return { url: audioUrl, refresh };
  return { url: signed.path === path ? signed.url : undefined, refresh };
}

/** An <audio> for a Music audio_url; keeps a #t= media fragment on the signed URL. */
export const MusicPrivateAudio = forwardRef(function MusicPrivateAudio({ src, onError, onPlay, onPause, onEnded, ...props }, forwardedRef) {
  const id = useId();
  const localRef = useRef(null);
  const [base, fragment] = typeof src === 'string' ? [src.split('#')[0], src.includes('#') ? src.slice(src.indexOf('#')) : ''] : [src, ''];
  const { url, refresh } = useMusicAudioSrc(base);
  useEffect(() => () => releaseAudioFocus(id), [id]);
  const ref = (node) => { localRef.current = node; if (typeof forwardedRef === 'function') forwardedRef(node); else if (forwardedRef) forwardedRef.current = node; };
  return <audio {...props} ref={ref} src={url ? `${url}${fragment}` : undefined}
    onPlay={(event) => { claimAudioFocus(id, () => localRef.current?.pause()); onPlay?.(event); }}
    onPause={(event) => { releaseAudioFocus(id); onPause?.(event); }}
    onEnded={(event) => { releaseAudioFocus(id); onEnded?.(event); }}
    onError={(event) => { refresh(); onError?.(event); }} />;
});
