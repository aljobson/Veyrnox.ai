'use client';

import { useEffect, useState } from 'react';
import { gatewayFetch } from './gateway';

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

/** @param {string | null | undefined} audioUrl  @returns {string | undefined} */
export function useMusicAudioSrc(audioUrl) {
  const path = privateMusicAssetPath(audioUrl);
  const [signed, setSigned] = useState({ path: null, url: undefined });
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    gatewayFetch(path)
      .then((asset) => { if (live && typeof asset?.url === 'string') setSigned({ path, url: asset.url }); })
      .catch(() => { if (live) setSigned({ path, url: undefined }); });
    return () => { live = false; };
  }, [path]);
  if (!audioUrl) return undefined;
  if (!path) return audioUrl;
  return signed.path === path ? signed.url : undefined;
}

/** An <audio> for a Music audio_url; keeps a #t= media fragment on the signed URL. */
export function MusicPrivateAudio({ src, ...props }) {
  const [base, fragment] = typeof src === 'string' ? [src.split('#')[0], src.includes('#') ? src.slice(src.indexOf('#')) : ''] : [src, ''];
  const resolved = useMusicAudioSrc(base);
  return <audio {...props} src={resolved ? `${resolved}${fragment}` : undefined} />;
}
