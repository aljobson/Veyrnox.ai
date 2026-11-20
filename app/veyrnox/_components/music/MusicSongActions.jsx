'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { musicActionLimitReason, musicActionOverLimit } from '../../_lib/music/actionLimits.js';

const jobIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

// An action whose source limit this song exceeds stays visible but cannot start, with the reason beside it.
function LimitedMenuItem({ ref, action, label, sourceDurationSeconds, className, onSelect }) {
  const limit = musicActionOverLimit(action, sourceDurationSeconds);
  if (!limit) return <button ref={ref} type="button" role="menuitem" onClick={onSelect} className={className}>{label}</button>;
  const reason = musicActionLimitReason(limit);
  return (
    <button ref={ref} type="button" role="menuitem" aria-disabled="true" aria-label={`${label}, works on songs ${reason}`} onClick={(event) => event.preventDefault()} className={`${className} cursor-not-allowed justify-between gap-3 opacity-60`}>
      <span>{label}</span>
      <span className="shrink-0 text-xs font-normal text-vx-fg-muted">{reason}</span>
    </button>
  );
}

export function MusicSongActions({
  beatEditor = false,
  songId, jobId, title, actions = ['view_lineage', 'organize'], onViewLineage, onShare, onDownload, onPublish, onCover, onMashup, onSample, onExtend, onReplace, onAddSection, onReuse, onStems, onTargetStem, onAddTrack, onCrop, onRender, onReverse, onSpeed,
  externalTriggerRef, sourceDurationSeconds,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const firstItemRef = useRef(null);
  const menuRef = useRef(null);
  const enabled = new Set(Array.isArray(actions) ? actions : []);
  const canViewLineage = enabled.has('view_lineage');
  const canShare = enabled.has('share_link') && typeof onShare === 'function';
  const canDownload = enabled.has('download_mp3') && typeof onDownload === 'function';
  const canPublish = enabled.has('publish') && typeof onPublish === 'function';
  const canCover = enabled.has('cover') && typeof onCover === 'function';
  // Remix needs Cover's gates, so Cover always comes first and takes the focus ref.
  const canMashup = canCover && enabled.has('mashup') && typeof onMashup === 'function';
  const canSample = canCover && enabled.has('sample') && typeof onSample === 'function';
  const canExtend = enabled.has('extend') && typeof onExtend === 'function';
  const canReplace = enabled.has('replace_section') && typeof onReplace === 'function';
  const canAddSection = enabled.has('add_section') && typeof onAddSection === 'function';
  const canReuse = enabled.has('reuse') && typeof onReuse === 'function';
  const canStems = enabled.has('stems') && typeof onStems === 'function';
  const canTargetStem = enabled.has('target_stem') && typeof onTargetStem === 'function';
  const canAddTrack = enabled.has('add_track') && typeof onAddTrack === 'function';
  const canStudio = enabled.has('open_studio');
  const canCrop = enabled.has('crop') && typeof onCrop === 'function';
  const canRender = enabled.has('render') && typeof onRender === 'function';
  // Reverse and Speed open the Render dialog on that tab, so Render always comes first.
  const canReverse = canRender && enabled.has('reverse') && typeof onReverse === 'function';
  const canSpeed = canRender && enabled.has('speed') && typeof onSpeed === 'function';
  const canEditor = enabled.has('open_editor') && jobIdPattern.test(jobId || '');
  const canOrganize = enabled.has('organize');

  useEffect(() => {
    if (!open) return undefined;
    firstItemRef.current?.focus();
    function closeFromOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function closeFromKeyboard(event) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [open]);

  if (!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canExtend && !canReplace && !canAddSection && !canReuse && !canStems && !canTargetStem && !canAddTrack && !canCrop && !canRender && !canStudio && !canEditor && !canOrganize) return null;

  function moveMenuFocus(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    let next = 0;
    if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === 'ArrowDown') next = current < 0 || current === items.length - 1 ? 0 : current + 1;
    items[next].focus();
  }

  const itemClass = 'flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-bold text-vx-fg-body hover:bg-vx-panel-raised hover:text-vx-fg focus:bg-vx-panel-raised focus:text-vx-fg focus:outline-none';



  return (
    <div ref={rootRef} className="relative ml-auto shrink-0">
      <button
        ref={(node) => {
          triggerRef.current = node;
          if (externalTriggerRef) externalTriggerRef.current = node;
        }}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${title}`}
        onClick={() => setOpen((value) => !value)}
        className="grid min-h-11 min-w-11 place-items-center rounded-full border border-vx-border text-lg font-black text-vx-fg-body hover:border-vx-border-boost hover:text-vx-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent"
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open ? (
        <div ref={menuRef} role="menu" aria-label={`Available actions for ${title}`} onKeyDown={moveMenuFocus} className="absolute right-0 z-30 mt-2 w-64 rounded-2xl border border-vx-border bg-vx-panel p-2 shadow-2xl">
          {canViewLineage ? (onViewLineage ? (
            <button
              ref={firstItemRef}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onViewLineage();
              }}
              className={itemClass}
            >
              View version lineage
            </button>
          ) : (
            <Link ref={firstItemRef} role="menuitem" href={`/app/music/songs/${songId}#lineage`} className={itemClass}>
              View version lineage
            </Link>
          )) : null}
          {canShare ? (
            <button
              ref={!canViewLineage ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onShare(); }}
              className={itemClass}
            >
              Create private share link
            </button>
          ) : null}
          {canDownload ? (
            <button
              ref={!canViewLineage && !canShare ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onDownload(); }}
              className={itemClass}
            >
              Download audio
            </button>
          ) : null}
          {canPublish ? (
            <button
              ref={!canViewLineage && !canShare && !canDownload ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onPublish(); }}
              className={itemClass}
            >
              Publish to creator profile
            </button>
          ) : null}
          {canCover ? (
            <LimitedMenuItem ref={!canViewLineage && !canShare && !canDownload && !canPublish ? firstItemRef : undefined} action="cover" label="Create a cover variation" sourceDurationSeconds={sourceDurationSeconds} className={itemClass} onSelect={() => { setOpen(false); onCover(); }} />
          ) : null}
          {canMashup ? (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onMashup(); }} className={itemClass}>
              Mash up with another song
            </button>
          ) : null}
          {canSample ? (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onSample(); }} className={itemClass}>
              Sample this song
            </button>
          ) : null}
          {canStems ? (
            <button
              ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover ? firstItemRef : undefined}
              type="button" role="menuitem" onClick={() => { setOpen(false); onStems(); }} className={itemClass}
            >
              Separate vocals and instrumental
            </button>
          ) : null}
          {canTargetStem ? (
            <LimitedMenuItem ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems ? firstItemRef : undefined} action="target_stem" label="Isolate one instrument" sourceDurationSeconds={sourceDurationSeconds} className={itemClass} onSelect={() => { setOpen(false); onTargetStem(); }} />
          ) : null}
          {canAddTrack ? (
            <LimitedMenuItem ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem ? firstItemRef : undefined} action="add_track" label="Add vocals or instrumental" sourceDurationSeconds={sourceDurationSeconds} className={itemClass} onSelect={() => { setOpen(false); onAddTrack(); }} />
          ) : null}
          {canReplace ? (
            <LimitedMenuItem ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem && !canAddTrack ? firstItemRef : undefined} action="replace_section" label="Replace a section" sourceDurationSeconds={sourceDurationSeconds} className={itemClass} onSelect={() => { setOpen(false); onReplace(); }} />
          ) : null}
          {canAddSection ? (
            <LimitedMenuItem ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem && !canReplace ? firstItemRef : undefined} action="add_section" label="Add a new section" sourceDurationSeconds={sourceDurationSeconds} className={itemClass} onSelect={() => { setOpen(false); onAddSection(); }} />
          ) : null}
          {canReuse ? (
            <button ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem && !canReplace && !canAddSection ? firstItemRef : undefined} type="button" role="menuitem" onClick={() => { setOpen(false); onReuse(); }} className={itemClass}>
              Reuse styles and lyrics
            </button>
          ) : null}
          {canExtend ? (
            <LimitedMenuItem ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem && !canReplace && !canAddSection && !canReuse ? firstItemRef : undefined} action="extend" label="Extend by 30 seconds" sourceDurationSeconds={sourceDurationSeconds} className={itemClass} onSelect={() => { setOpen(false); onExtend(); }} />
          ) : null}
          {canCrop ? (
            <button
              ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canExtend && !canReplace && !canAddSection && !canReuse && !canStems && !canTargetStem ? firstItemRef : undefined}
              type="button" role="menuitem" onClick={() => { setOpen(false); onCrop(); }} className={itemClass}
            >
              Crop beginning or end
            </button>
          ) : null}
          {canRender ? (
            <button
              ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canExtend && !canReplace && !canAddSection && !canReuse && !canStems && !canTargetStem && !canCrop ? firstItemRef : undefined}
              type="button" role="menuitem" onClick={() => { setOpen(false); onRender(); }} className={itemClass}
            >
              Fade, speed, reorder, or remaster
            </button>
          ) : null}
          {canReverse ? (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onReverse(); }} className={itemClass}>
              Reverse
            </button>
          ) : null}
          {canSpeed ? (
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onSpeed(); }} className={itemClass}>
              Adjust speed
            </button>
          ) : null}
          {canStudio ? (
            <a ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canExtend && !canReplace && !canAddSection && !canReuse && !canStems && !canTargetStem && !canAddTrack && !canCrop && !canRender ? firstItemRef : undefined} role="menuitem" href={beatEditor ? `/app/music/beats/new?song=${encodeURIComponent(songId)}` : `/app/music/studio/${songId}`} className={itemClass}>
              {beatEditor ? 'Open in Beats' : 'Open in Studio workspace'}
            </a>
          ) : null}
          {canEditor ? (
            <Link ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canExtend && !canReplace && !canAddSection && !canReuse && !canStems && !canTargetStem && !canAddTrack && !canCrop && !canRender && !canStudio ? firstItemRef : undefined} role="menuitem" href={`/app/editor?job=${encodeURIComponent(jobId)}&name=${encodeURIComponent(title)}`} className={itemClass}>
              Open in Veyrnox.ai Edit
            </Link>
          ) : null}
          {canOrganize ? (
            <Link ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canExtend && !canReplace && !canAddSection && !canReuse && !canStems && !canTargetStem && !canAddTrack && !canCrop && !canRender && !canStudio && !canEditor ? firstItemRef : undefined} role="menuitem" href="/app/music/library" className={itemClass}>
              Organize in Music Library
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
