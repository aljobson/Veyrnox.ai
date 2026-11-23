'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { useAssetUrl } from '../_lib/useAssetUrl';

const TOOLS = [
  ['smart-cut', 'app.smartCut.workbench.tool.smartCut', 'smart-cut-panel'],
  ['cut', 'app.smartCut.workbench.tool.cut', 'clip-cut-controls'],
  ['sound', 'app.smartCut.workbench.tool.sound', 'clip-sound-controls'],
  ['text', 'app.smartCut.workbench.tool.text', 'clip-text-controls'],
  ['layers', 'app.smartCut.workbench.tool.layers', 'clip-layer-controls'],
];

const clampIndex = (value, length) => Math.max(0, Math.min(Math.max(0, length - 1), value));
const clipStart = (item) => Math.max(0, Number(item?.in_s) || 0);
const clipEnd = (item) => item?.out_s != null && Number.isFinite(Number(item.out_s)) ? Number(item.out_s) : Number(item?.duration) || 0;
const clipOutputDuration = (item, showSlow) => Math.max(0, clipEnd(item) - clipStart(item)) * (showSlow && Number(item?.slow) > 1 ? Number(item.slow) : 1);
const time = (seconds) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;

export function SmartCutWorkbench({ showText = true, items, output, showSlow, disabled, canUndo, canRedo, onUndo, onRedo }) {
  const { t } = useI18n();
  const [activeSelection, setActiveSelection] = useState(() => ({ uid: items[0]?.uid || null, index: 0 }));
  const [activeTool, setActiveTool] = useState('smart-cut');
  const [zoom, setZoom] = useState(1);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const previewRef = useRef(null);
  const matchedIndex = items.findIndex((item) => item.uid === activeSelection.uid);
  const activeIndex = matchedIndex >= 0 ? matchedIndex : clampIndex(activeSelection.index, items.length);
  const active = items[activeIndex] || null;
  const start = clipStart(active);
  const end = clipEnd(active);
  const playbackRate = showSlow && Number(active?.slow) > 1 ? 1 / Number(active.slow) : 1;
  const asset = useAssetUrl(active?.job_id, active?.asset_url);

  useEffect(() => {
    const next = clipStart(active);
    previewRef.current?.pause();
    setPlayhead(next);
    setPlaying(false);
    if (previewRef.current) previewRef.current.currentTime = next;
  }, [active?.uid, start, end]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  function chooseClip(index) {
    const nextIndex = clampIndex(index, items.length);
    setActiveSelection({ uid: items[nextIndex]?.uid || null, index: nextIndex });
  }

  function stepClip(delta) {
    chooseClip(clampIndex(activeIndex + delta, items.length));
  }

  function seek(value) {
    const next = Number(value);
    setPlayhead(next);
    if (previewRef.current) previewRef.current.currentTime = next;
  }

  function togglePlayback() {
    const video = previewRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
      video.play().catch(() => setPlaying(false));
    } else {
      video.pause();
    }
  }

  function openTool(tool, targetId) {
    setActiveTool(tool);
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel-raised" aria-labelledby="smart-cut-workbench-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-vx-border px-4 py-3">
        <div>
          <p className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-accent">{t('app.smartCut.workbench.eyebrow')}</p>
          <h3 id="smart-cut-workbench-title" className="mt-1 text-sm font-black">{t('app.smartCut.workbench.title')}</h3>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={disabled || !canUndo} onClick={onUndo} aria-label={t('app.smartCut.workbench.undoLabel')} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold disabled:opacity-35">{t('app.smartCut.workbench.undo')}</button>
          <button type="button" disabled={disabled || !canRedo} onClick={onRedo} aria-label={t('app.smartCut.workbench.redoLabel')} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold disabled:opacity-35">{t('app.smartCut.workbench.redo')}</button>
        </div>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(220px,0.72fr)_minmax(0,1.28fr)]">
        <div className="mx-auto flex w-full max-w-[320px] flex-col">
          <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-vx-border bg-black shadow-[0_14px_42px_rgb(0_0_0/0.24)]">
            {active ? <video
              ref={previewRef}
              src={asset.url}
              playsInline
              preload="metadata"
              aria-label={t('app.smartCut.workbench.preview', { name: active.name || active.job_id })}
              className="h-full w-full object-contain"
              onError={asset.onError}
              onLoadedMetadata={(event) => {
                asset.onLoad();
                event.currentTarget.currentTime = start;
                event.currentTarget.playbackRate = playbackRate;
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                const current = event.currentTarget.currentTime;
                setPlayhead(current);
                if (!event.currentTarget.paused && current >= end) {
                  event.currentTarget.pause();
                  event.currentTarget.currentTime = start;
                  setPlayhead(start);
                }
              }}
            /> : <div className="grid h-full place-items-center px-6 text-center text-xs text-white/60">{t('app.smartCut.workbench.empty')}</div>}
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between bg-gradient-to-b from-black/70 to-transparent p-3 text-[10px] font-bold text-white">
              <span>{active?.name || t('app.smartCut.workbench.tool.smartCut')}</span><span>{time(output)}</span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button type="button" disabled={disabled || activeIndex === 0} onClick={() => stepClip(-1)} aria-label={t('app.smartCut.workbench.previous')} className="grid min-h-10 min-w-10 place-items-center rounded-full border border-vx-border disabled:opacity-35">‹</button>
            <button type="button" disabled={disabled || !active} onClick={togglePlayback} className="min-h-10 min-w-24 rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:opacity-35">{t(playing ? 'app.smartCut.workbench.pause' : 'app.smartCut.workbench.play')}</button>
            <button type="button" disabled={disabled || activeIndex >= items.length - 1} onClick={() => stepClip(1)} aria-label={t('app.smartCut.workbench.next')} className="grid min-h-10 min-w-10 place-items-center rounded-full border border-vx-border disabled:opacity-35">›</button>
          </div>
          <label className="mt-3 grid gap-1 text-[10px] font-bold text-vx-fg-muted">{t('app.smartCut.workbench.playhead')}
            <input type="range" min={start} max={Math.max(start, end)} step="0.01" value={Math.min(end, Math.max(start, playhead))} disabled={disabled || !active || end <= start} onChange={(event) => seek(event.target.value)} className="w-full accent-[rgb(var(--vx-accent))]" />
            <span className="font-vx-mono text-[10px] vx-num">{time(playhead - start)} / {time(end - start)}</span>
          </label>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-extrabold">{t('app.smartCut.workbench.timeline')}</p><p className="mt-1 text-[11px] text-vx-fg-muted">{t('app.smartCut.workbench.timelineHelp')}</p></div>
            <div role="group" aria-label={t('app.smartCut.workbench.zoomGroup')} className="flex items-center gap-2 text-[10px] font-bold text-vx-fg-muted"><span>{t('app.smartCut.workbench.zoom')}</span>
              <button type="button" aria-label={t('app.smartCut.workbench.zoomOut')} disabled={disabled || zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))} className="grid min-h-9 min-w-9 place-items-center rounded-full border border-vx-border disabled:opacity-35">−</button>
              <span className="w-10 text-center font-vx-mono vx-num">{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label={t('app.smartCut.workbench.zoomIn')} disabled={disabled || zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))} className="grid min-h-9 min-w-9 place-items-center rounded-full border border-vx-border disabled:opacity-35">+</button>
            </div>
          </div>

          <div role="region" className="mt-3 overflow-x-auto rounded-xl border border-vx-border bg-vx-base p-2" aria-label={t('app.smartCut.workbench.thumbnailTimeline')}>
            <div className="flex min-w-max gap-2">
              {items.map((item, index) => {
                const duration = clipOutputDuration(item, showSlow);
                return <button
                  key={item.uid}
                  type="button"
                  disabled={disabled}
                  aria-pressed={index === activeIndex}
                  onClick={() => chooseClip(index)}
                  style={{ width: `${Math.max(108, duration * 18) * zoom}px` }}
                  className="overflow-hidden rounded-lg border border-vx-border bg-vx-panel text-left aria-pressed:border-vx-accent aria-pressed:ring-2 aria-pressed:ring-vx-accent/30 disabled:opacity-50"
                >
                  <TimelineThumbnail item={item} />
                  <span className="block truncate px-2 pt-2 text-[11px] font-bold">{index + 1}. {item.name || item.job_id.slice(0, 8)}</span>
                  <span className="block px-2 pb-2 pt-1 font-vx-mono text-[9px] text-vx-fg-muted vx-num">{duration.toFixed(1)} s</span>
                </button>;
              })}
            </div>
          </div>

          <nav className="mt-4 grid grid-cols-5 gap-1 rounded-xl border border-vx-border bg-vx-base p-1" aria-label={t('app.smartCut.workbench.tools')}>
            {TOOLS.filter(([tool]) => showText || tool !== 'text').map(([tool, labelKey, targetId]) => <button key={tool} type="button" disabled={disabled} aria-current={activeTool === tool ? 'location' : undefined} data-active={activeTool === tool} onClick={() => openTool(tool, targetId)} className="min-h-12 rounded-lg px-1 text-[10px] font-extrabold text-vx-fg-muted hover:text-vx-fg data-[active=true]:bg-vx-accent data-[active=true]:text-vx-accent-ink disabled:opacity-40">{t(labelKey)}</button>)}
          </nav>
          <p className="mt-3 rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-5 text-vx-fg-muted">
            {t(`app.smartCut.workbench.help.${activeTool === 'smart-cut' ? 'smartCut' : activeTool}`)}
          </p>
        </div>
      </div>
    </section>
  );
}
function TimelineThumbnail({ item }) {
  const asset = useAssetUrl(item.job_id, item.asset_url);
  const videoRef = useRef(null);
  const start = clipStart(item);
  useEffect(() => {
    if (videoRef.current?.readyState >= 1) videoRef.current.currentTime = start;
  }, [start]);
  return <video
    ref={videoRef}
    src={asset.url}
    muted
    playsInline
    preload="metadata"
    tabIndex={-1}
    aria-hidden="true"
    className="aspect-video w-full bg-black object-cover"
    onError={asset.onError}
    onLoadedMetadata={(event) => {
      asset.onLoad();
      event.currentTarget.currentTime = start;
    }}
  />;
}
