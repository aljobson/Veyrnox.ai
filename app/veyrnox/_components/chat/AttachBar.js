'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IMAGE_TYPES, addableCount, isImageFile } from '../../_lib/chatImages';

/**
 * The images chosen for the next reply: local files with a preview each. Nothing is uploaded until Send, so
 * removing one costs nothing. Previews are object URLs, released when an image goes or the composer unmounts.
 */
export function useAttachments(max) {
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState(null);
  const live = useRef([]);
  useEffect(() => { live.current = items; }, [items]);
  useEffect(() => () => { for (const i of live.current) URL.revokeObjectURL(i.preview); }, []);

  const add = useCallback((fileList) => {
    const picked = Array.from(fileList || []);
    const images = picked.filter(isImageFile);
    setNotice(images.length < picked.length ? 'Only PNG, JPEG and WebP images can be attached.' : null);
    setItems((cur) => {
      const room = addableCount(cur.length, max);
      if (images.length > room) setNotice(`You can attach up to ${max} images.`);
      const next = images.slice(0, room).map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, preview: URL.createObjectURL(file) }));
      return [...cur, ...next];
    });
  }, [max]);
  const remove = useCallback((id) => {
    setItems((cur) => { const gone = cur.find((i) => i.id === id); if (gone) URL.revokeObjectURL(gone.preview); return cur.filter((i) => i.id !== id); });
    setNotice(null);
  }, []);
  const clear = useCallback(() => {
    setItems((cur) => { for (const i of cur) URL.revokeObjectURL(i.preview); return []; });
    setNotice(null);
  }, []);
  return { items, notice, add, remove, clear };
}

/** The paperclip: opens the file picker. Shown only for a model that reads images. */
export function AttachButton({ onPick, disabled, full }) {
  const input = useRef(null);
  return (
    <>
      <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden tabIndex={-1}
        onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
      <button type="button" disabled={disabled || full} onClick={() => input.current?.click()} aria-label="Attach images"
        title={full ? 'The most images for one reply' : 'Attach images'}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-vx-fg-muted hover:text-vx-fg disabled:opacity-40">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l8.3-8.3" />
        </svg>
      </button>
    </>
  );
}

/** Thumbnails of the chosen images, each with a remove control. */
export function AttachChips({ items, onRemove, disabled }) {
  if (items.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label="Images for the next reply">
      {items.map((i, n) => (
        <li key={i.id} className="relative">
          <img src={i.preview} alt={`Image ${n + 1}`} className="h-14 w-14 rounded-lg border border-vx-border object-cover" />
          <button type="button" disabled={disabled} onClick={() => onRemove(i.id)} aria-label={`Remove image ${n + 1}`}
            className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-vx-border bg-vx-base text-xs leading-none text-vx-fg">×</button>
        </li>
      ))}
    </ul>
  );
}
