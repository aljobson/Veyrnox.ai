'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { fetchTemplate } from '../_lib/useTemplates.js';
import { useClipPlayback } from '../_lib/useClipPlayback';
import { presetTitle } from '../_lib/tokens';

// The template's own poster (and its muted preview loop) above the swap composer, from /api/templates/<id> clip data.
// Playback follows _lib/playbackPolicy through useClipPlayback: hover or focus with a mouse, in view on touch (5 s cap),
// never under reduced motion or data saver. The video is decoration; the poster carries the alt text.
const RATIO_RE = /^\d{1,5}(\s*[/:]\s*\d{1,5})?$/;
const SAFE_PATH_RE = /^\/(?!\/)[A-Za-z0-9/_.-]+$/;
export function swapPreviewRatio(value) {
  return typeof value === 'string' && RATIO_RE.test(value.trim()) ? value.trim().replace(':', '/') : '9 / 16';
}
const safePath = (value) => (typeof value === 'string' && SAFE_PATH_RE.test(value) ? value : null);

export function SwapTemplatePreview({ id }) {
  const { t } = useI18n();
  const [template, setTemplate] = useState(undefined); // undefined: loading, null: none
  const [posterFailed, setPosterFailed] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const rootRef = useRef(null), videoRef = useRef(null);
  useEffect(() => {
    let live = true;
    setTemplate(undefined); setPosterFailed(false); setVideoFailed(false);
    fetchTemplate(id).then(found => { if (live) setTemplate(found); });
    return () => { live = false; };
  }, [id]);
  const poster = safePath(template?.clip?.poster), video = safePath(template?.clip?.video);
  const showVideo = Boolean(video) && !videoFailed;
  useClipPlayback(rootRef, videoRef, showVideo && Boolean(template));
  if (template === null || (template && !poster && !video)) return null;
  const ratio = swapPreviewRatio(template?.clip?.aspectRatio);
  const label = template ? t('presets.detail.preview', { title: presetTitle(template.name) }) : '';
  return <div ref={rootRef} data-swap-preview aria-busy={template === undefined} style={{ aspectRatio: ratio }}
    className="relative mx-auto w-full max-w-xs overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
    {poster && !posterFailed && <img src={poster} alt={label} className="absolute inset-0 h-full w-full object-cover" onError={() => setPosterFailed(true)} />}
    {showVideo && <video ref={videoRef} src={video} poster={poster && !posterFailed ? poster : undefined} muted loop playsInline preload="none" aria-hidden="true"
      disablePictureInPicture disableRemotePlayback onError={() => setVideoFailed(true)} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />}
  </div>;
}
