'use client';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IMAGE_TYPES, addableCount, isImageFile } from '../../_lib/chatImages';
import { VIDEO_TYPES, isVideoFile, extractFrames } from '../../_lib/videoFrames';

const FRAMES_PER_VIDEO = 4; // a clip is attached as up to four frames, each an ordinary image

/**
 * The images chosen for the next reply: local files with a preview each, or the person's own Library images (by the id of
 * the job that made them). Nothing is uploaded until Send, so removing one costs nothing. A file's preview is an object URL,
 * released when it goes or the composer unmounts; a Library image's preview is its short-lived link and needs no release.
 * A video is attached as a few frames taken in the browser (ADR-0068 amendment 3): each is a file like any other, marked `video`.
 */
export function useAttachments(max) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState(null);
  const live = useRef([]);
  useEffect(() => { live.current = items; }, [items]);
  useEffect(() => () => { for (const i of live.current) if (!i.asset) URL.revokeObjectURL(i.preview); }, []);

  // Up to four frames from one clip, taken here: the video is never uploaded. It needs room for at least two images.
  const addVideo = useCallback(async (file, more) => {
    const room = addableCount(live.current.length, max);
    if (room < 2) { setNotice(t('app.chat.attach.videoRoom', {count:locale === 'en' ? max : new Intl.NumberFormat(localeTag(locale)).format(max)})); return; }
    setNotice(t("app.chat.attach.reading"));
    try {
      const frames = await extractFrames(file, Math.min(FRAMES_PER_VIDEO, room));
      setItems((cur) => {
        const take = frames.slice(0, addableCount(cur.length, max));
        return [...cur, ...take.map((f) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f, preview: URL.createObjectURL(f), video: true }))];
      });
      setNotice(more ? t("app.chat.attach.first") : null);
    } catch {
      setNotice(t("app.chat.attach.failed"));
    }
  }, [max,t,locale]);

  const add = useCallback((fileList) => {
    const picked = Array.from(fileList || []);
    const images = picked.filter(isImageFile);
    const videos = picked.filter(isVideoFile);
    setNotice(images.length + videos.length < picked.length ? t("app.chat.attach.types") : null);
    if (videos.length) addVideo(videos[0], videos.length > 1);
    setItems((cur) => {
      const room = addableCount(cur.length, max);
      if (images.length > room) setNotice(t(pluralKey(t, locale, 'app.chat.attach.limit', max), {count:locale === 'en' ? max : new Intl.NumberFormat(localeTag(locale)).format(max)}));
      const next = images.slice(0, room).map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file, preview: URL.createObjectURL(file) }));
      return [...cur, ...next];
    });
  }, [max,t,locale,addVideo]);
  const remove = useCallback((id) => {
    setItems((cur) => { const gone = cur.find((i) => i.id === id); if (gone && !gone.asset) URL.revokeObjectURL(gone.preview); return cur.filter((i) => i.id !== id); });
    setNotice(null);
  }, []);
  const clear = useCallback(() => {
    setItems((cur) => { for (const i of cur) if (!i.asset) URL.revokeObjectURL(i.preview); return []; });
    setNotice(null);
  }, []);
  /** One of the person's own Library images, picked in the Library picker: { id (job id), url, label }. */
  const addAsset = useCallback(({ id, url, label }) => {
    setNotice(null);
    setItems((cur) => {
      if (cur.some((i) => i.asset === id)) return cur;
      if (addableCount(cur.length, max) < 1) { setNotice(t(pluralKey(t, locale, 'app.chat.attach.limit', max), {count:locale === 'en' ? max : new Intl.NumberFormat(localeTag(locale)).format(max)})); return cur; }
      return [...cur, { id: `asset-${id}`, asset: id, preview: url, label }];
    });
  }, [max,t,locale]);
  return { items, notice, setNotice, add, addAsset, remove, clear };
}

/** The paperclip: opens the file picker. Shown only for a model that reads images. */
export function AttachButton({ onPick, disabled, full }) {
  const { t } = useI18n();
  const input = useRef(null);
  return (
    <>
      <input ref={input} type="file" accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(',')} multiple hidden tabIndex={-1}
        onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
      <button type="button" disabled={disabled || full} onClick={() => input.current?.click()} aria-label={t("app.chat.attach.label")}
        title={full ? t("app.chat.controls.imageLimit") : t("app.chat.attach.hint")}
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
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  if (items.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-2" aria-label={t("app.chat.attach.list")}>
      {items.map((i, n) => (
        <li key={i.id} className="relative">
          <img src={i.preview} alt={t('app.chat.attach.image', {number:number(n+1)})} className="h-14 w-14 rounded-lg border border-vx-border object-cover" />
          <button type="button" disabled={disabled} onClick={() => onRemove(i.id)} aria-label={t('app.chat.attach.remove', {number:number(n+1)})}
            className="absolute -end-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-vx-border bg-vx-base text-xs leading-none text-vx-fg">×</button>
        </li>
      ))}
    </ul>
  );
}
