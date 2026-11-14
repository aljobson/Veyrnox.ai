'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const jobIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function MusicSongActions({
  songId, jobId, title, actions = ['view_lineage', 'organize'], onViewLineage, onShare, onDownload, onPublish, onCover, onExtend, onReplace, onAddSection, onReuse, onStems, onTargetStem, onAddTrack, onCrop, onRender,
  externalTriggerRef,
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
            <button
              ref={!canViewLineage && !canShare && !canDownload && !canPublish ? firstItemRef : undefined}
              type="button" role="menuitem" onClick={() => { setOpen(false); onCover(); }} className={itemClass}
            >
              Create a cover variation
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
            <button
              ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems ? firstItemRef : undefined}
              type="button" role="menuitem" onClick={() => { setOpen(false); onTargetStem(); }} className={itemClass}
            >
              Isolate one instrument
            </button>
          ) : null}
          {canAddTrack ? (
            <button
              ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem ? firstItemRef : undefined}
              type="button" role="menuitem" onClick={() => { setOpen(false); onAddTrack(); }} className={itemClass}
            >
              Add vocals or instrumental
            </button>
          ) : null}
          {canReplace ? (
            <button ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem && !canAddTrack ? firstItemRef : undefined} type="button" role="menuitem" onClick={() => { setOpen(false); onReplace(); }} className={itemClass}>
              Replace a section
            </button>
          ) : null}
          {canAddSection ? (
            <button ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem && !canReplace ? firstItemRef : undefined} type="button" role="menuitem" onClick={() => { setOpen(false); onAddSection(); }} className={itemClass}>
              Add a new section
            </button>
          ) : null}
          {canReuse ? (
            <button ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem && !canReplace && !canAddSection ? firstItemRef : undefined} type="button" role="menuitem" onClick={() => { setOpen(false); onReuse(); }} className={itemClass}>
              Reuse styles and lyrics
            </button>
          ) : null}
          {canExtend ? (
            <button
              ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canStems && !canTargetStem && !canReplace && !canAddSection && !canReuse ? firstItemRef : undefined}
              type="button" role="menuitem" onClick={() => { setOpen(false); onExtend(); }} className={itemClass}
            >
              Extend by 30 seconds
            </button>
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
          {canStudio ? (
            <Link ref={!canViewLineage && !canShare && !canDownload && !canPublish && !canCover && !canExtend && !canReplace && !canAddSection && !canReuse && !canStems && !canTargetStem && !canAddTrack && !canCrop && !canRender ? firstItemRef : undefined} role="menuitem" href={`/app/music/studio/${songId}`} className={itemClass}>
              Open in Studio workspace
            </Link>
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
