'use client';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { gatewayFetch } from '../../../_lib/gateway.js';
import { assetState, subscribeAssets } from '../../../_lib/music/beat/beatAssets.js';
import { AI_LABELS, AI_INSTRUMENTS, BEAT_AI_KEYS, EXAMPLE_PROMPT_KEYS, startExampleRotation, actionEligibility, aiText, actionBody, aiPaths, generateBody, trackCapacity, aiError } from '../../../_lib/music/beat/beatAi.mjs';
import { tickSeconds } from '../../../_lib/music/beat/beatAudioSegments.mjs';
import { action, button, input } from './beatStyles';
const idle = Object.freeze({ status: 'ready' });
export default function BeatAiActionSheet({ request, doc, afterTrackId }) {
  const { t } = useI18n();
  const { selection, record, quote, busy, online } = request, op = selection.op;
  const dialog = useRef(null), [song, setSong] = useState(null), [sourceError, setSourceError] = useState('');
  const draftKey = `veyrnox.beat.ai.draft.${doc.id}.${op}`;
  const [prompt, setPrompt] = useState(() => { try { return record?.prompt || selection.prompt || localStorage.getItem(draftKey)?.slice(0, 400) || ''; } catch { return ''; } }), [key, setKey] = useState('');
  // The placeholder rotates through example parts while the field is empty; reduced motion keeps the first.
  const [example, setExample] = useState(0);
  useEffect(() => (prompt ? undefined : startExampleRotation({ win: typeof window === 'undefined' ? null : window, onIndex: setExample })), [prompt]);
  const [instrument, setInstrument] = useState(record?.instrument || selection.instrument || 'drums'), [rights, setRights] = useState(false);
  const [discardKey, setDiscardKey] = useState(null), [promptTouched, setPromptTouched] = useState(false);
  const source = selection.source, asset = source?.asset;
  const region = selection.region || { start: selection.placement?.start, length: selection.placement?.length, phaseSec: selection.placement?.phaseSec, reverse: selection.placement?.reverse || false };
  const held = useSyncExternalStore(subscribeAssets, () => asset ? assetState(asset, doc.tempo.bpm) : idle, () => idle);
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    gatewayFetch(`/music/songs/${source.songId}`, { signal: controller.signal }).then(setSong).catch(e => { if (!controller.signal.aborted) setSourceError(aiError(e, op, t)); });
    return () => controller.abort();
  }, [source, op, t]);
  useEffect(() => { request.reset(); }, [doc.tempo.bpm, doc.cycle.start, doc.cycle.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const promptNeeded = ['generate', 'extend', 'replace'].includes(op);
  const promptError = promptNeeded && (!prompt.trim() || prompt.trim().length > 400)
    ? t(op === 'generate' ? 'app.music.beat.ai.a6' : 'app.music.beat.ai.a24') : '';
  const showPromptError = !!promptError && (promptTouched || prompt.length > 0);
  let reason = record ? '' : op === 'generate' ? trackCapacity(doc, t) : sourceError || actionEligibility(op, doc, region, asset, song, held, t);
  let body;
  if (!reason && !record) {
    try { body = op === 'generate' ? generateBody(doc, prompt, key) : actionBody(op, { doc, region, asset, prompt, instrument, rights }); }
    catch (e) { reason = aiError(e, op, t); }
  }
  function change(set, value) { set(value); request.reset(); if (set === setPrompt) { try { localStorage.setItem(draftKey, value); } catch { /* The pending receipt still must persist before any spend. */ } } }
  function price() {
    if (reason || !body) return;
    const paths = aiPaths(op, source?.songId);
    const placement = { afterTrackId: op === 'generate' ? afterTrackId : selection.trackId, sourceTrackId: op === 'generate' ? null : selection.trackId,
      regionId: selection.region?.id || null, start: op === 'generate' ? doc.cycle.start : region.start,
      length: op === 'generate' ? doc.cycle.end - doc.cycle.start : region.length,
      phaseSec: op === 'generate' ? 0 : region.phaseSec, reverse: region.reverse || false, cycle: { ...doc.cycle } };
    request.price(paths.quote, body, { op, source: source || null, placement, prompt, instrument, submitPath: paths.submit });
  }
  const seconds = tickSeconds(doc.cycle.end - doc.cycle.start, doc.tempo.bpm);
  return <dialog data-beat-read ref={dialog} aria-labelledby="beat-ai-title" onCancel={e => { e.preventDefault(); request.close(); }}
    className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-vx-border bg-vx-panel p-5 text-vx-fg backdrop:bg-vx-base/80 md:inset-y-0 md:start-auto md:end-0 md:max-h-dvh md:max-w-md md:rounded-none">
    <div className="flex items-center justify-between gap-3"><h2 id="beat-ai-title" className="text-xl font-bold"><span aria-hidden="true">✦ </span>{aiText(AI_LABELS[op], t)}</h2><button className={button} disabled={!!busy} onClick={request.close} aria-label={t('app.music.beat.ui.close.ai.parts')}>{t('app.music.beat.close')}</button></div>
    <p className="my-3 text-sm text-vx-fg-muted">{t('app.music.beat.ui.see.the.exact.price.before.send.results.also.stay.in.your.music.librar')}</p>
    <fieldset disabled={!!busy || !!record} className="space-y-4">
      {promptNeeded && <label className="flex flex-col gap-2">{t('app.music.beat.ui.describe.the.part')}<textarea autoFocus className={`${input} min-h-28`} maxLength={400} value={prompt} placeholder={t(EXAMPLE_PROMPT_KEYS[example])} onChange={e => change(setPrompt, e.target.value)} onBlur={() => setPromptTouched(true)} aria-invalid={showPromptError} aria-describedby="beat-ai-prompt-error" /><span id="beat-ai-prompt-error" className="text-sm text-vx-danger">{showPromptError ? promptError : ''}</span></label>}
      {op === 'generate' && <><label className="flex flex-col gap-2">{t('app.music.beat.ui.key')}<select className={input} value={key} onChange={e => change(setKey, e.target.value)}><option value="">{t('app.music.beat.ui.auto')}</option>{BEAT_AI_KEYS.map(k => <option key={k}>{k}</option>)}</select></label>
        <p>{t('app.music.beat.ui.bars')}{Math.floor(doc.cycle.start / 3840) + 1}–{Math.ceil(doc.cycle.end / 3840)} · {seconds.toFixed(1)}{t('app.music.beat.ui.s')}</p></>}
      {op === 'targetStems' && <label className="flex flex-col gap-2">{t('app.music.beat.ui.instrument')}<select className={input} value={instrument} onChange={e => change(setInstrument, e.target.value)}>{AI_INSTRUMENTS.map(i => <option key={i}>{i}</option>)}</select></label>}
      {op !== 'generate' && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" checked={rights} onChange={e => change(setRights, e.target.checked)} />{t('app.music.beat.ui.i.own.or.have.permission.to.separate.this.recording')}</label>}
    </fieldset>
    {!online && <p className="my-4" role="status">{t('app.music.beat.ui.generate.needs.a.connection')}</p>}
    {reason && reason !== promptError && <p id="beat-ai-validation" className="my-4 text-vx-danger">{reason}</p>}
    {quote && <div className="my-4 rounded-xl border border-vx-border p-3"><p className="text-lg font-bold text-vx-money">{quote.total_credits}{t('app.music.beat.ui.credits')}</p><p>{t('app.music.beat.ui.balance')}{quote.balance} → {quote.balance_after}</p>
      {!quote.affordable && <p>{t('app.music.beat.ui.not.enough.credits')}<Link className="inline-flex min-h-11 items-center underline focus-visible:outline-vx-accent" href="/pricing">{t('app.music.beat.ui.buy.credits')}</Link></p>}</div>}
    <div className="my-4 flex flex-wrap gap-3">
      {!record && !quote && <button className={action} disabled={request.readOnly || !!busy || !online || !!reason} onClick={price}>{busy || t('app.music.beat.ui.price')}</button>}
      {(quote || record) && <button className={action} disabled={(request.readOnly && !record?.requestId) || !!busy || !online || (!record && (!quote.affordable || !!reason))} onClick={request.send}>{busy || (record ? record.requestId ? t('app.music.beat.labels.l0') : t('app.music.beat.labels.l1') : t('app.music.beat.labels.l2'))}</button>}
      {quote && !record && <button className={button} disabled={!!busy} onClick={request.reset}>{t('app.music.beat.ui.change')}</button>}
      {record && !record.requestId && discardKey !== record.key && <button className={button} disabled={!!busy} onClick={() => setDiscardKey(record.key)}>{t('app.music.beat.ui.discard.request')}</button>}
    </div>
    {record && !record.requestId && discardKey === record.key && <div className="my-4 space-y-3" role="group" aria-label={t('app.music.beat.ui.confirm.discard.request')}>
      <p role="status">{t('app.music.beat.ui.discard.this.request.from.the.beat.this.does.not.cancel.a.request.alre')}</p>
      <div className="flex flex-wrap gap-3"><button className={button} disabled={!!busy} onClick={request.discard}>{t('app.music.beat.ui.confirm.discard')}</button>
        <button className={button} disabled={!!busy} onClick={() => setDiscardKey(null)}>{t('app.music.beat.ui.keep.request')}</button></div>
    </div>}
    {request.elapsed >= 3 && <p role="status">{busy || t('app.music.beat.ui.making.parts')} · {request.elapsed}{t('app.music.beat.ui.s')}</p>}
    {request.message && <p className="my-3" role="status">{request.message}</p>}
    {request.error && <p className="my-3 text-vx-danger" role="alert">{request.error}</p>}
  </dialog>;
}
