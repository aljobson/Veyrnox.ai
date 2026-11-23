'use client';
import { pushJobHistory } from '../_lib/jobHistory';
import { mixedShapes, shapeMismatch, shapeValue } from '../../../lib/videoShape.mjs';
import { VideoShapeBadge } from './VideoShapeBadge';
import { useI18n } from '../../../components/I18nProvider';
import { useEffect, useRef, useState } from 'react';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../lib/i18n/translate.mjs';
import Link from 'next/link';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { Modal } from './Modal';
import { AssetLoadStatus } from './AssetLoadStatus';
import { ConfirmDialog } from './ConfirmDialog';
import { SmartCutPlanner } from './SmartCutPlanner';
import { SmartCutAnalyse } from './SmartCutAnalyse';
import { SmartCutWorkbench } from './SmartCutWorkbench';
import { applySmartCutState, commitSmartCutGroupedEditState, endSmartCutEditGroupState, patchSmartCutMetadataState, redoSmartCutEditState, smartCutHasEdits, undoSmartCutEditState, undoSmartCutState } from '../_lib/smartCut';
import { gatewayFetch, GatewayError, makeIdempotencyKey } from '../_lib/gateway';

// Clip Editor sheet (docs/editor/PRD.md §4). The server re-checks every
// number here against the stored files (lib/clipEditSources.js); this only
// saves the user a refused request.
const MAX_OUTPUT_S = 60;
const MAX_CLIPS = 10;
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

function EditorIcon({ name }) {
  const path = name === 'close'
    ? <path d="m6 6 12 12M18 6 6 18" />
    : name === 'earlier'
      ? <path d="m6 10 6-6 6 6M12 4v16" />
      : name === 'later'
        ? <path d="m6 14 6 6 6-6M12 20V4" />
        : <><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13" /><path d="M11 11v5M13 11v5" /></>;
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

/**
 * @param {{ clips: {job_id:string, asset_url:string, name?:string}[], audios: {job_id:string, name?:string}[],
 *           credits5s: number|null, onClose: () => void, onSubmitted: (job:object) => void }} props
 */
export function EditSheet({ clips, audios, credits5s, onClose, onSubmitted, smartCut = false }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
  const errorCopy = code => code === 'mixed_aspect' ? t('app.editor.sheet.error.server_mixed_aspect') : code === 'rate_limited' ? t('cinema.creatorApplication.tooManyRequestsWaitAMinute') : tOr(t, `app.editor.sheet.error.${code}`, t('app.editor.sheet.fallback'), { limit: number(code === 'too_long' ? MAX_OUTPUT_S : SLOW_MAX_SOURCE_S) });
  const [editState, setEditState] = useState(() => ({
    items: clips.map((c, i) => ({ ...c, uid: `${c.job_id}#${i}`, in_s: 0, out_s: null, duration: null, ratio: null })),
    smartCutSnapshot: null,
    smartCutApplied: null,
    editPast: [],
    editFuture: [],
    editGroup: null,
  }));
  const { items, smartCutSnapshot, smartCutApplied, editPast, editFuture } = editState;
  const [analyses, setAnalyses] = useState(() => new Map());
  // job id -> whether its file has an audio track. The server refuses to join clips with and without sound,
  // so it is read up front: Smart Cut analysis is paid, and must not run on a set that cannot be joined.
  const [audioByJob, setAudioByJob] = useState(() => ({}));
  const audioAsked = useRef(new Set());
  const addAnalysis = (jobId, analysis) => setAnalyses((map) => new Map(map).set(jobId, analysis));
  const [audioId, setAudioId] = useState('');
  const [offset, setOffset] = useState(0);
  const [captions, setCaptions] = useState(false);
  const [style, setStyle] = useState(CAPTION_STYLES[0]);
  const showCaptions = captionsPreview();
  const showSlow = slowPreview();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmSmartCutUndo, setConfirmSmartCutUndo] = useState(false);
  const [pendingSmartCutApply, setPendingSmartCutApply] = useState(null);
  const [smartCutApplyRevision, setSmartCutApplyRevision] = useState(0);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const commitItems = (change, group = null) => {
    setEditState((state) => {
      const nextItems = change(state.items);
      return commitSmartCutGroupedEditState(state, nextItems, group);
    });
  };
  const update = (i, patch, group = null) => {
    commitItems((current) => {
      const item = current[i];
      if (!item || Object.entries(patch).every(([key, value]) => Object.is(item[key], value))) return current;
      return current.map((x, k) => (k === i ? { ...x, ...patch } : x));
    }, group);
  };
  const finishEditGroup = () => setEditState(endSmartCutEditGroupState);
  const updateMetadata = (uid, patch) => {
    setEditState((state) => patchSmartCutMetadataState(state, uid, patch));
  };
  const move = (i, d) => {
    commitItems((current) => {
      const j = i + d;
      if (j < 0 || j >= current.length) return current;
      const next = [...current];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const remove = (i) => {
    commitItems((current) => current.filter((_, k) => k !== i));
  };
  const commitSmartCutApply = (nextItems) => {
    setEditState((state) => ({ ...applySmartCutState(state, nextItems), editPast: [], editFuture: [] }));
    setSmartCutApplyRevision((revision) => revision + 1);
  };
  const applySmartCut = (nextItems) => {
    if (smartCutHasEdits(items, smartCutApplied)) {
      setPendingSmartCutApply(nextItems);
      return false;
    }
    commitSmartCutApply(nextItems);
    return true;
  };
  const undoSmartCut = () => {
    if (smartCutHasEdits(items, smartCutApplied)) {
      setConfirmSmartCutUndo(true);
      return;
    }
    setEditState(undoSmartCutState);
  };
  const undoEdit = () => setEditState(undoSmartCutEditState);
  const redoEdit = () => setEditState(redoSmartCutEditState);

  useEffect(() => {
    for (const jobId of new Set(items.map((x) => x.job_id))) {
      if (!jobId || audioAsked.current.has(jobId)) continue;
      audioAsked.current.add(jobId);
      gatewayFetch(`/jobs/${encodeURIComponent(jobId)}/media-info`)
        // null = could not be read: that never blocks (the server still checks), it only ends the wait.
        .then((info) => setAudioByJob((current) => ({ ...current, [jobId]: typeof info?.has_audio === 'boolean' ? info.has_audio : null })))
        .catch(() => setAudioByJob((current) => ({ ...current, [jobId]: null })));
    }
  }, [items]);

  const loaded = items.every((x) => x.duration != null);
  // A slowed clip runs `slow` times longer in the result (the server counts it the same way).
  const slowOf = (x) => (showSlow && x.slow > 1 ? x.slow : 1);
  const output = round(items.reduce((s, x) => s + Math.max(0, (x.out_s ?? 0) - x.in_s) * slowOf(x), 0));
  const slowedSource = round(items.reduce((s, x) => s + (slowOf(x) > 1 ? Math.max(0, (x.out_s ?? 0) - x.in_s) : 0), 0));
  const slowNoAudio = slowedSource > 0 && !audioId;
  const slowTooLong = slowedSource > SLOW_MAX_SOURCE_S;
  const mixed = mixedShapes(items);
  const audioFlags = items.map((x) => audioByJob[x.job_id]).filter((v) => typeof v === 'boolean');
  const mixedAudio = audioFlags.some((v) => v !== audioFlags[0]);
  // Until every clip's sound has been read, a pair could still turn out mixed: no paid step may start in that gap.
  // Smart Cut's render ran on supplier steps; editing is Veyrnox.ai's own work, so Create (and the paid analysis that only
  // feeds it) stay off until the own render replaces them. The free local plan still works.
  const createPaused = smartCut;
  const audioPending = items.length > 1 && items.some((x) => audioByJob[x.job_id] === undefined);
  const badRange = items.some((x) => x.duration != null && !(x.in_s >= 0 && x.out_s > x.in_s && x.out_s <= x.duration));
  const tooManyClips = items.length > MAX_CLIPS;
  const noop = items.length === 1 && !audioId && !captions && slowOf(items[0]) === 1 && loaded && items[0].in_s === 0 && items[0].out_s >= items[0].duration;
  // The same unit count the gateway bills (lib/clipEdit.js editUnits): a
  // many-clip edit costs per step, so steps set the floor under the length.
  const steps = items.filter((x) => !(x.duration != null && x.in_s === 0 && x.out_s >= x.duration)).length
    + (items.length > 1 ? 1 : 0) + (audioId ? 1 : 0) + (captions ? CAPTIONS_UNITS : 0)
    + items.reduce((n, x) => n + (slowOf(x) > 1 ? SLOW_UNITS_PER_SECOND * Math.ceil((x.out_s ?? 0) - x.in_s - 1e-9) : 0), 0);
  const units = Math.max(1, Math.ceil(output / UNIT_S), steps);
  const cost = credits5s != null && output > 0 ? credits5s * units : null;
  const blocked = createPaused || !items.length || !loaded || mixed || mixedAudio || audioPending || badRange || tooManyClips || noop || output > MAX_OUTPUT_S || slowNoAudio || slowTooLong || cost == null || busy;

  useEffect(() => {
    if (confirmCreate && (cost == null || blocked)) setConfirmCreate(false);
  }, [blocked, confirmCreate, cost]);

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
      pushJobHistory({ job_id: r.job_id, idempotent: r.idempotent, model_id: 'clip-edit', credits: cost });
      onSubmitted({ job_id: r.job_id, idempotent: r.idempotent, credits: cost, balance_after: r.balance_after, name: t(pluralKey(t, locale, 'app.editor.sheet.job', items.length), { count: number(items.length) }) });
    } catch (e) {
      setError(e instanceof GatewayError ? e.code : INTERNAL_ERROR);
      setBusy(false);
    }
  }

  const clipRows = items.map((x, i) => (
    <ClipRow key={x.uid} item={x} mismatch={shapeMismatch(x, items[0])} index={i} count={items.length}
      showSlow={showSlow} onChange={(p, group) => update(i, p, group)} onEditEnd={finishEditGroup} onMetadata={(p) => updateMetadata(x.uid, p)} onMove={(d) => move(i, d)} onRemove={() => remove(i)} />
  ));

  return (<>
    <Modal aria-labelledby="edit-sheet-title" onCancel={() => !busy && onClose()} className="vx-overlay-sheet items-end sm:items-center justify-center p-0 sm:p-6">
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-h-[calc(100dvh-env(safe-area-inset-top,0px))] flex-col overflow-hidden rounded-t-2xl border border-vx-border bg-vx-base sm:max-h-[92dvh] sm:max-w-[760px] sm:rounded-2xl"
      >
        <div className="mb-4 flex shrink-0 items-center justify-between px-4 pt-4 sm:px-6 sm:pt-6">
          <h2 id="edit-sheet-title" className="text-xl font-black">{t(pluralKey(t, locale, 'app.editor.sheet.title', items.length), { count: number(items.length) })}</h2>
          <button onClick={onClose} disabled={busy} aria-label={t("app.editor.workspace.close")} className="grid min-h-11 min-w-11 place-items-center rounded-full border border-transparent text-vx-fg-muted hover:border-vx-border hover:text-vx-fg">
            <span aria-hidden="true" className="sr-only">✕</span>
            <EditorIcon name="close" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6 sm:pb-6">
          {smartCut && <SmartCutWorkbench showText={showCaptions} items={items} output={output} showSlow={showSlow} disabled={busy} canUndo={editPast.length > 0} canRedo={editFuture.length > 0} onUndo={undoEdit} onRedo={redoEdit} />}
          {createPaused && <p role="status" className="mb-4 rounded-xl border border-vx-border bg-vx-base p-3 text-xs font-semibold leading-5 text-vx-fg-muted">{t('app.smartCut.create.paused')}</p>}
          {smartCut && (mixed || mixedAudio) && <p role="alert" className="mb-4 rounded-xl border border-vx-danger/50 bg-vx-danger/10 p-3 text-xs font-semibold leading-5 text-vx-danger">{t(mixed ? 'app.editor.sheet.error.mixed_aspect' : 'app.editor.sheet.error.mixed_audio')}</p>}
          {smartCut && <SmartCutAnalyse clips={items} analyses={analyses} onAnalysed={addAnalysis} disabled={busy || mixed || mixedAudio || audioPending || createPaused} />}
          {smartCut && <div id="smart-cut-panel" className="scroll-mt-4">
            <SmartCutPlanner
              clips={items}
              analyses={analyses.size ? analyses : null}
              disabled={busy}
              planningDisabled={mixed || mixedAudio || audioPending}
              applyRevision={smartCutApplyRevision}
              onApply={applySmartCut}
              onUndo={smartCutSnapshot ? undoSmartCut : null}
              startOpen
            />
          </div>}

          {smartCut ? <section id="clip-layer-controls" className="scroll-mt-4" aria-labelledby="clip-layer-heading">
            <h3 id="clip-layer-heading" className="sr-only">{t('app.smartCut.workbench.layersHeading')}</h3>
            <ol id="clip-cut-controls" className="flex scroll-mt-4 flex-col gap-3">{clipRows}</ol>
          </section> : <ol className="flex flex-col gap-3">{clipRows}</ol>}

          <div id={smartCut ? 'clip-sound-controls' : undefined} className={`mt-4 rounded-xl border border-vx-border bg-vx-panel p-3 flex flex-wrap items-end gap-3${smartCut ? ' scroll-mt-4' : ''}`}>
            <label className="flex flex-col gap-1 text-xs text-vx-fg-muted grow min-w-[200px]">
              {t("app.editor.sheet.audio")}<select value={audioId} onChange={(e) => setAudioId(e.target.value)} className="min-h-11 rounded-lg bg-vx-base border border-vx-field px-2 py-2 text-sm text-vx-fg">
                <option value="">{t("app.editor.sheet.noAudio")}</option>
                {audios.map((a) => <option key={a.job_id} value={a.job_id}>{a.name || a.job_id.slice(0, 8)}</option>)}
              </select>
            </label>
            {audioId && (
              <label className="flex flex-col gap-1 text-xs text-vx-fg-muted">
                {t("app.editor.sheet.startAt")}<input type="number" min={0} step={0.1} value={offset} onChange={(e) => setOffset(e.target.value)}
                  className="min-h-11 w-24 rounded-lg bg-vx-base border border-vx-field px-2 py-2 text-sm text-vx-fg" />
              </label>
            )}
            {audioId && <p className="text-xs text-vx-fg-muted basis-full">{t("app.editor.sheet.audioHelp")}</p>}
          </div>

          {slowedSource > 0 && (
            <p className="mt-3 text-xs text-vx-fg-muted">
              {t("app.editor.sheet.slowHelp")}</p>
          )}

          {showCaptions && <div id={smartCut ? 'clip-text-controls' : undefined} className={`mt-3 rounded-xl border border-vx-border bg-vx-panel p-3 flex flex-wrap items-center gap-3${smartCut ? ' scroll-mt-4' : ''}`}>
            {showCaptions ? <>
              <label className="flex min-h-11 items-center gap-2 text-sm text-vx-fg">
                <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
                {t("app.editor.sheet.captions")}</label>
              {captions && (
                <label className="flex items-center gap-2 text-xs text-vx-fg-muted">
                  {t("app.editor.sheet.style")}<select value={style} onChange={(e) => setStyle(e.target.value)} className="min-h-11 rounded-lg bg-vx-base border border-vx-field px-2 py-2 text-sm text-vx-fg">
                    {CAPTION_STYLES.map((n) => <option key={n} value={n}>{n[0].toUpperCase() + n.slice(1)}</option>)}
                  </select>
                </label>
              )}
              {captions && (
                <p className="text-xs text-vx-fg-muted basis-full">
                  {t("app.editor.sheet.captionHelp")}</p>
              )}
            </> : null}
          </div>}

          <div role="status" className="mt-3 text-sm min-h-[1.25rem]">
            {mixed && <span className="text-vx-danger">{t('app.editor.sheet.error.mixed_aspect')}</span>}
            {!mixed && mixedAudio && <span className="text-vx-danger">{t('app.editor.sheet.error.mixed_audio')}</span>}
            {!mixed && output > MAX_OUTPUT_S && <span className="text-vx-danger">{t('app.editor.sheet.error.too_long', { limit: number(MAX_OUTPUT_S) })}</span>}
            {!mixed && badRange && <span className="text-vx-danger">{t('app.editor.sheet.error.clip_range')}</span>}
            {tooManyClips && <span className="text-vx-danger">{t('app.editor.sheet.error.too_many_clips', { limit: number(MAX_CLIPS) })}</span>}
            {slowTooLong && <span className="text-vx-danger">{t('app.editor.sheet.error.slow_too_long', { limit: number(SLOW_MAX_SOURCE_S) })}</span>}
            {!slowTooLong && slowNoAudio && <span className="text-vx-danger">{t('app.editor.sheet.error.slow_needs_audio')}</span>}
            {noop && <span className="text-vx-fg-muted">{t('app.editor.sheet.error.nothing_to_do')}</span>}
            {error && <span className="text-vx-danger">{errorCopy(error)}</span>}
            {error === 'insufficient_balance' && <Link href="/app/credits" className="ms-2 inline-flex min-h-11 items-center font-bold text-vx-accent underline underline-offset-4" onClick={onClose}>{t("app.create.addCredits")}</Link>}
          </div>
        </div>

        <div id={smartCut ? 'clip-create-controls' : undefined} className="shrink-0 border-t border-vx-border bg-vx-base px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-3 sm:px-6 sm:pb-6">
          <div className="flex items-center justify-between gap-3">
            <span className="font-vx-mono text-xs text-vx-fg-muted vx-num">{t('app.editor.sheet.output', { seconds: locale === 'en' ? output.toFixed(1) : output.toLocaleString(localeTag(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
            <button onClick={() => smartCut ? setConfirmCreate(true) : submit()} disabled={blocked}
              className="vx-press min-h-11 rounded-full px-5 py-2.5 font-bold bg-vx-accent text-vx-accent-ink disabled:opacity-40">
              {busy ? t("app.editor.sheet.starting") : cost == null ? t("app.editor.sheet.create") : smartCut ? t('app.smartCut.price.review', { cost: number(cost) }) : t('app.editor.sheet.createCost', { cost: number(cost) })}
            </button>
          </div>
        </div>
      </div>
    </Modal>
    {confirmSmartCutUndo && <ConfirmDialog
      title={t('app.smartCut.confirm.undo.title')}
      body={t('app.smartCut.confirm.undo.body')}
      confirmLabel={t('app.smartCut.confirm.undo.action')}
      tone="danger"
      onCancel={() => setConfirmSmartCutUndo(false)}
      onConfirm={() => {
        setEditState(undoSmartCutState);
        setConfirmSmartCutUndo(false);
      }}
    />}
    {pendingSmartCutApply && <ConfirmDialog
      title={t('app.smartCut.confirm.replace.title')}
      body={t('app.smartCut.confirm.replace.body')}
      confirmLabel={t('app.smartCut.confirm.replace.action')}
      tone="danger"
      onCancel={() => setPendingSmartCutApply(null)}
      onConfirm={() => {
        const nextItems = pendingSmartCutApply;
        setPendingSmartCutApply(null);
        commitSmartCutApply(nextItems);
      }}
    />}
    {confirmCreate && cost != null && <ConfirmDialog
      title={t('app.smartCut.price.title', {
        seconds: locale === 'en' ? output.toFixed(1) : output.toLocaleString(localeTag(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        cost: number(cost),
      })}
      body={t('app.smartCut.price.body')}
      confirmLabel={t('app.smartCut.price.confirm', { cost: number(cost) })}
      onCancel={() => setConfirmCreate(false)}
      onConfirm={() => {
        setConfirmCreate(false);
        submit();
      }}
    />}
  </>);
}

function ClipRow({ item, mismatch, index, count, showSlow, onChange, onEditEnd, onMetadata, onMove, onRemove }) {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
  const asset = useAssetUrl(item.job_id, item.asset_url);
  const ref = useRef(null);
  const d = item.duration;
  const setPoint = (key, v, grouped = false) => onChange(
    { [key]: Math.max(0, Math.min(d ?? 0, Number(v) || 0)) },
    grouped ? `${item.uid}:${key}` : null,
  );
  return (
    <li className="rounded-xl border border-vx-border bg-vx-panel p-3 flex flex-col sm:flex-row gap-3">
      <div className="relative w-full sm:w-44 shrink-0">
        <video ref={ref} src={asset.url} onError={asset.onError} controls muted playsInline preload="metadata"
          className="w-full aspect-video sm:aspect-auto sm:h-28 bg-black rounded-lg object-contain"
          onLoadedMetadata={(e) => {
            asset.onLoad();
            const v = e.currentTarget;
            onMetadata({ duration: v.duration, ratio: item.shape_ambiguous ? null : shapeValue(v.videoWidth, v.videoHeight), width: v.videoWidth, height: v.videoHeight });
          }} />
        <AssetLoadStatus asset={asset} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold truncate">{number(index + 1)}. {item.name || item.job_id.slice(0, 8)}</span>
          <span className="flex shrink-0 gap-1">
            <button onClick={() => onMove(-1)} disabled={index === 0} aria-label={t("app.editor.legacy.earlier")} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-vx-border text-vx-fg-muted hover:text-vx-fg disabled:opacity-30"><span aria-hidden="true" className="sr-only">↑</span><EditorIcon name="earlier" /></button>
            <button onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t("app.editor.legacy.later")} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-vx-border text-vx-fg-muted hover:text-vx-fg disabled:opacity-30"><span aria-hidden="true" className="sr-only">↓</span><EditorIcon name="later" /></button>
            <button onClick={onRemove} aria-label={t("app.editor.sheet.remove")} className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-vx-border text-vx-fg-muted hover:border-vx-danger hover:text-vx-danger"><span aria-hidden="true" className="sr-only">✕</span><EditorIcon name="remove" /></button>
          </span>
        </div>
        <VideoShapeBadge item={item} mismatch={mismatch} />
        {POINTS.map((key) => (
          <div key={key} className="flex items-center gap-2 text-xs text-vx-fg-muted">
            <label className="flex items-center gap-2">
              <span className="w-8">{key === 'in_s' ? t("app.editor.sheet.in") : t("app.editor.sheet.out")}</span>
              <input type="number" min={0} max={d ?? undefined} step={0.1} disabled={d == null}
                value={item[key] == null ? '' : round(item[key])} onChange={(e) => setPoint(key, e.target.value, true)} onBlur={onEditEnd}
                className="min-h-11 w-24 rounded-lg bg-vx-base border border-vx-field px-2 py-1.5 text-sm text-vx-fg" />
            </label>
            <button disabled={d == null} onClick={() => setPoint(key, ref.current ? ref.current.currentTime : 0)}
              className="min-h-11 rounded-full border border-vx-border px-3 py-1 hover:text-vx-fg disabled:opacity-40">
              {t("app.editor.sheet.playhead")}</button>
          </div>
        ))}
        {showSlow && (
          <label className="flex items-center gap-2 text-xs text-vx-fg-muted">
            <span className="w-16">{t("app.editor.sheet.speed")}</span>
            <select value={item.slow || 1} onChange={(e) => onChange({ slow: Number(e.target.value) })}
              className="min-h-11 rounded-lg bg-vx-base border border-vx-field px-2 py-1.5 text-sm text-vx-fg">
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
