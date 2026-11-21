'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { fetchTemplate } from '../_lib/useTemplates.js';
import { presetTitle } from '../_lib/tokens';

// The template's own clip above the swap composer, from /api/templates/<id> clip data, in a full player (controls, sound).
// Nothing loads until played (preload none); the poster shows until then and stays if the clip fails.
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
  useEffect(() => {
    let live = true;
    setTemplate(undefined); setPosterFailed(false); setVideoFailed(false);
    fetchTemplate(id).then(found => { if (live) setTemplate(found); });
    return () => { live = false; };
  }, [id]);
  const poster = safePath(template?.clip?.poster), video = safePath(template?.clip?.video);
  const showVideo = Boolean(video) && !videoFailed;
  if (template === null || (template && !poster && !video)) return null;
  const ratio = swapPreviewRatio(template?.clip?.aspectRatio);
  const label = template ? t('presets.detail.preview', { title: presetTitle(template.name) }) : '';
  return <div data-swap-preview aria-busy={template === undefined} style={{ aspectRatio: ratio }}
    className="relative mx-auto w-full max-w-xs overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
    {poster && !posterFailed && <img src={poster} alt={label} className="absolute inset-0 h-full w-full object-cover" onError={() => setPosterFailed(true)} />}
    {showVideo && <video src={video} poster={poster && !posterFailed ? poster : undefined} controls playsInline preload="none" aria-label={label}
      onError={() => setVideoFailed(true)} className="absolute inset-0 h-full w-full bg-black object-cover" />}
  </div>;
}
