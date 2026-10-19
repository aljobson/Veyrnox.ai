'use client';
import { useI18n } from '../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../lib/i18n/translate.mjs';
import Link from 'next/link';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { Modal } from './Modal';
import { AssetLoadStatus } from './AssetLoadStatus';
import { gatewayFetch, GatewayError, makeIdempotencyKey } from '../_lib/gateway';

// Clip Editor sheet (docs/editor/PRD.md §4). The server re-checks every
// number here against the stored files (lib/clipEditSources.js); this only
// saves the user a refused request.
const MAX_OUTPUT_S = 60;
const UNIT_S = 5;
// Captions (docs/editor/CAPTIONS.md): billed as this many units on their own,
// the same number lib/clipEdit.js CAPTIONS_UNITS charges (a test pins them).
// A short pick of the presets the server accepts; it checks the name itself.
const CAPTIONS_UNITS = 7;
const CAPTION_STYLES = ['simple', 'plain', 'glass', 'whisper', 'backdrop', 'corpo', 'handwritten', 'terminal'];
// Per-browser preview switch on top of the server flag, like veyrnox_editor.
const captionsPreview = () => { try { return window.localStorage.getItem('veyrnox_editor_captions') === '1'; } catch { return false; } };
// Slow motion (docs/editor/SPEED.md): the same numbers lib/clipEdit.js holds (a test pins them). The price is
// a deliberately high placeholder until fal's invoice is read, so the control is behind a switch of its own.
const SLOW_FACTORS = [2, 3, 4];
const SLOW_UNITS_PER_SECOND = 20;
const SLOW_MAX_SOURCE_S = 15;
const slowPreview = () => { try { return window.localStorage.getItem('veyrnox_editor_slow') === '1'; } catch { return false; } };

const POINTS = ['in_s', 'out_s'];
const INTERNAL_ERROR = 'internal';

const round = (n) => Math.round(n * 100) / 100;

/**
 * @param {{ clips: {job_id:string, asset_url:string, name?:string}[], audios: {job_id:string, name?:string}[],
 *           credits5s: number|null, onClose: () => void, onSubmitted: (job:object) => void }} props
 */
export function EditSheet({ clips, audios, credits5s, onClose, onSubmitted }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
  const errorCopy = code => code === 'rate_limited' ? t('cinema.creatorApplication.tooManyRequestsWaitAMinute') : tOr(t, `app.editor.sheet.error.${code}`, t('app.editor.sheet.fallback'), { limit: number(code === 'too_long' ? MAX_OUTPUT_S : SLOW_MAX_SOURCE_S) });
  const [items, setItems] = useState(() => clips.map((c, i) => ({ ...c, uid: `${c.job_id}#${i}`, in_s: 0, out_s: null, duration: null, ratio: null })));
  const [audioId, setAudioId] = useState('');
  const [offset, setOffset] = useState(0);
  const [captions, setCaptions] = useState(false);
  const [style, setStyle] = useState(CAPTION_STYLES[0]);
  const showCaptions = captionsPreview();
  const showSlow = slowPreview();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);



  const update = (i, patch) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i, d) => setItems((xs) => {
    const j = i + d;
    if (j < 0 || j >= xs.length) return xs;
    const next = [...xs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i) => setItems((xs) => xs.filter((_, k) => k !== i));

  const loaded = items.every((x) => x.duration != null);
  // A slowed clip runs `slow` times longer in the result (the server counts it the same way).
  const slowOf = (x) => (showSlow && x.slow > 1 ? x.slow : 1);
  const output = round(items.reduce((s, x) => s + Math.max(0, (x.out_s ?? 0) - x.in_s) * slowOf(x), 0));
  const slowedSource = round(items.reduce((s, x) => s + (slowOf(x) > 1 ? Math.max(0, (x.out_s ?? 0) - x.in_s) : 0), 0));
  const slowNoAudio = slowedSource > 0 && !audioId;
  const slowTooLong = slowedSource > SLOW_MAX_SOURCE_S;
  const mixed = new Set(items.filter((x) => x.ratio).map((x) => x.ratio)).size > 1;
  const badRange = items.some((x) => x.duration != null && !(x.in_s >= 0 && x.out_s > x.in_s && x.out_s <= x.duration));
  const noop = items.length === 1 && !audioId && !captions && slowOf(items[0]) === 1 && loaded && items[0].in_s === 0 && items[0].out_s >= items[0].duration;
  // The same unit count the gateway bills (lib/clipEdit.js editUnits): a
  // many-clip edit costs per step, so steps set the floor under the length.
  const steps = items.filter((x) => !(x.duration != null && x.in_s === 0 && x.out_s >= x.duration)).length
    + (items.length > 1 ? 1 : 0) + (audioId ? 1 : 0) + (captions ? CAPTIONS_UNITS : 0)
    + items.reduce((n, x) => n + (slowOf(x) > 1 ? SLOW_UNITS_PER_SECOND * Math.ceil((x.out_s ?? 0) - x.in_s - 1e-9) : 0), 0);
  const units = Math.max(1, Math.ceil(output / UNIT_S), steps);
  const cost = credits5s != null && output > 0 ? credits5s * units : null;
  const blocked = !items.length || !loaded || mixed || badRange || noop || output > MAX_OUTPUT_S || slowNoAudio || slowTooLong || cost == null || busy;

  async function submit() {
    if (blocked) return;
    setBusy(true);
    setError(null);
    const inputs = {
      clips: items.map((x) => ({ asset_id: x.job_id, in_s: round(x.in_s), out_s: round(x.out_s), ...(slowOf(x) > 1 ? { slow: slowOf(x) } : {}) })),
      ...(audioId ? { audio: { asset_id: audioId, offset_s: round(Number(offset) || 0) } } : {}),
      ...(captions ? { captions: { preset: style } } : {}),
    };
    try {
      const r = await gatewayFetch('/generations', {
        method: 'POST',
        body: JSON.stringify({ model_id: 'clip-edit', idempotency_key: makeIdempotencyKey(), inputs }),
      });
      onSubmitted({ job_id: r.job_id, credits: cost, balance_after: r.balance_after, name: t(pluralKey(t, locale, 'app.editor.sheet.job', items.length), { count: number(items.length) }) });
    } catch (e) {
      setError(e instanceof GatewayError ? e.code : INTERNAL_ERROR);
      setBusy(false);
    }
  }

  return (
    <Modal aria-labelledby="edit-sheet-title" onCancel={() => !busy && onClose()} className="vx-overlay-sheet items-end sm:items-center justify-center p-0 sm:p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-[760px] max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-vx-border bg-vx-base p-4 sm:p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="edit-sheet-title" className="text-xl font-black">{t(pluralKey(t, locale, 'app.editor.sheet.title', items.length), { count: number(items.length) })}</h2>
          <button onClick={onClose} disabled={busy} aria-label={t("app.editor.workspace.close")} className="text-vx-fg-muted hover:text-vx-fg px-2 py-1">✕</button>
        </div>

        <ol className="flex flex-col gap-3">
          {items.map((x, i) => (
            <ClipRow key={x.uid} item={x} index={i} count={items.length}
              showSlow={showSlow} onChange={(p) => update(i, p)} onMove={(d) => move(i, d)} onRemove={() => remove(i)} />
          ))}
        </ol>

        <div className="mt-4 rounded-xl border border-vx-border bg-vx-panel p-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-vx-fg-muted grow min-w-[200px]">
            {t("app.editor.sheet.audio")}<select value={audioId} onChange={(e) => setAudioId(e.target.value)} className="rounded-lg bg-vx-base border border-vx-field px-2 py-2 text-sm text-vx-fg">
              <option value="">{t("app.editor.sheet.noAudio")}</option>
              {audios.map((a) => <option key={a.job_id} value={a.job_id}>{a.name || a.job_id.slice(0, 8)}</option>)}
            </select>
          </label>
          {audioId && (
            <label className="flex flex-col gap-1 text-xs text-vx-fg-muted">
              {t("app.editor.sheet.startAt")}<input type="number" min={0} step={0.1} value={offset} onChange={(e) => setOffset(e.target.value)}
                className="w-24 rounded-lg bg-vx-base border border-vx-field px-2 py-2 text-sm text-vx-fg" />
            </label>
          )}
          {audioId && <p className="text-xs text-vx-fg-muted basis-full">{t("app.editor.sheet.audioHelp")}</p>}
        </div>

        {slowedSource > 0 && (
          <p className="mt-3 text-xs text-vx-fg-muted">
            {t("app.editor.sheet.slowHelp")}</p>
        )}

        {showCaptions && (
          <div className="mt-3 rounded-xl border border-vx-border bg-vx-panel p-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-vx-fg">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
              {t("app.editor.sheet.captions")}</label>
            {captions && (
              <label className="flex items-center gap-2 text-xs text-vx-fg-muted">
                {t("app.editor.sheet.style")}<select value={style} onChange={(e) => setStyle(e.target.value)} className="rounded-lg bg-vx-base border border-vx-field px-2 py-2 text-sm text-vx-fg">
                  {CAPTION_STYLES.map((n) => <option key={n} value={n}>{n[0].toUpperCase() + n.slice(1)}</option>)}
                </select>
              </label>
            )}
            {captions && (
              <p className="text-xs text-vx-fg-muted basis-full">
                {t("app.editor.sheet.captionHelp")}</p>
            )}
          </div>
        )}

        <div role="status" className="mt-3 text-sm min-h-[1.25rem]">
          {mixed && <span className="text-vx-danger">{t('app.editor.sheet.error.mixed_aspect')}</span>}
          {!mixed && output > MAX_OUTPUT_S && <span className="text-vx-danger">{t('app.editor.sheet.error.too_long', { limit: number(MAX_OUTPUT_S) })}</span>}
          {!mixed && badRange && <span className="text-vx-danger">{t('app.editor.sheet.error.clip_range')}</span>}
          {slowTooLong && <span className="text-vx-danger">{t('app.editor.sheet.error.slow_too_long', { limit: number(SLOW_MAX_SOURCE_S) })}</span>}
          {!slowTooLong && slowNoAudio && <span className="text-vx-danger">{t('app.editor.sheet.error.slow_needs_audio')}</span>}
          {noop && <span className="text-vx-fg-muted">{t('app.editor.sheet.error.nothing_to_do')}</span>}
          {error && <span className="text-vx-danger">{errorCopy(error)}</span>}
          {error === 'insufficient_balance' && <Link href="/app/credits" className="ms-2 font-bold text-vx-accent underline underline-offset-4" onClick={onClose}>{t("app.create.addCredits")}</Link>}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-vx-mono text-xs text-vx-fg-muted vx-num">{t('app.editor.sheet.output', { seconds: locale === 'en' ? output.toFixed(1) : output.toLocaleString(localeTag(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
          <button onClick={submit} disabled={blocked}
            className="rounded-full px-5 py-2.5 font-bold bg-vx-accent text-vx-accent-ink disabled:opacity-40">
            {busy ? t("app.editor.sheet.starting") : cost == null ? t("app.editor.sheet.create") : t('app.editor.sheet.createCost', { cost: number(cost) })}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ClipRow({ item, index, count, showSlow, onChange, onMove, onRemove }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
  const asset = useAssetUrl(item.job_id, item.asset_url);
  const ref = useRef(null);
  const d = item.duration;
  const setPoint = (key, v) => onChange({ [key]: Math.max(0, Math.min(d ?? 0, Number(v) || 0)) });
  return (
    <li className="rounded-xl border border-vx-border bg-vx-panel p-3 flex flex-col sm:flex-row gap-3">
      <div className="relative w-full sm:w-44 shrink-0">
        <video ref={ref} src={asset.url} onError={asset.onError} controls muted playsInline preload="metadata"
          className="w-full aspect-video sm:aspect-auto sm:h-28 bg-black rounded-lg object-contain"
          onLoadedMetadata={(e) => {
            asset.onLoad();
            const v = e.currentTarget;
            onChange({ duration: v.duration, out_s: item.out_s ?? v.duration, ratio: v.videoHeight ? (v.videoWidth / v.videoHeight).toFixed(2) : null });
          }} />
        <AssetLoadStatus asset={asset} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold truncate">{number(index + 1)}. {item.name || item.job_id.slice(0, 8)}</span>
          <span className="flex gap-1 shrink-0">
            <button onClick={() => onMove(-1)} disabled={index === 0} aria-label={t("app.editor.legacy.earlier")} className="px-2 py-1 rounded-sm border border-vx-border disabled:opacity-30">↑</button>
            <button onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t("app.editor.legacy.later")} className="px-2 py-1 rounded-sm border border-vx-border disabled:opacity-30">↓</button>
            <button onClick={onRemove} aria-label={t("app.editor.sheet.remove")} className="px-2 py-1 rounded-sm border border-vx-border">✕</button>
          </span>
        </div>
        {POINTS.map((key) => (
          <div key={key} className="flex items-center gap-2 text-xs text-vx-fg-muted">
            <label className="flex items-center gap-2">
              <span className="w-8">{key === 'in_s' ? t("app.editor.sheet.in") : t("app.editor.sheet.out")}</span>
              <input type="number" min={0} max={d ?? undefined} step={0.1} disabled={d == null}
                value={item[key] == null ? '' : round(item[key])} onChange={(e) => setPoint(key, e.target.value)}
                className="w-24 rounded-lg bg-vx-base border border-vx-field px-2 py-1.5 text-sm text-vx-fg" />
            </label>
            <button disabled={d == null} onClick={() => setPoint(key, ref.current ? ref.current.currentTime : 0)}
              className="rounded-full border border-vx-border px-3 py-1 hover:text-vx-fg disabled:opacity-40">
              {t("app.editor.sheet.playhead")}</button>
          </div>
        ))}
        {showSlow && (
          <label className="flex items-center gap-2 text-xs text-vx-fg-muted">
            <span className="w-16">{t("app.editor.sheet.speed")}</span>
            <select value={item.slow || 1} onChange={(e) => onChange({ slow: Number(e.target.value) })}
              className="rounded-lg bg-vx-base border border-vx-field px-2 py-1.5 text-sm text-vx-fg">
              <option value={1}>{t("app.publish.inbox.priority.normal")}</option>
              {SLOW_FACTORS.map((n) => <option key={n} value={n}>{t('app.editor.sheet.slower', { factor: number(n) })}</option>)}
            </select>
          </label>
        )}
        {d != null && <span className="font-vx-mono text-[11px] text-vx-fg-muted vx-num">{t('app.editor.sheet.clipDuration', { seconds: number(round(d)) })}</span>}
      </div>
    </li>
  );
}
