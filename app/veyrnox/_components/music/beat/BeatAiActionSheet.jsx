'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { gatewayFetch } from '../../../_lib/gateway.js';
import { assetState, subscribeAssets } from '../../../_lib/music/beat/beatAssets.js';
import { AI_LABELS, AI_INSTRUMENTS, BEAT_AI_KEYS, actionEligibility, actionBody, aiPaths, generateBody, trackCapacity, aiError } from '../../../_lib/music/beat/beatAi.mjs';
import { tickSeconds } from '../../../_lib/music/beat/beatAudioSegments.mjs';
import { action, button, input } from './beatStyles';
const idle = Object.freeze({ status: 'ready' });
export default function BeatAiActionSheet({ request, doc, afterTrackId }) {
  const { selection, record, quote, busy, online } = request, op = selection.op;
  const dialog = useRef(null), [song, setSong] = useState(null), [sourceError, setSourceError] = useState('');
  const draftKey = `veyrnox.beat.ai.draft.${doc.id}.${op}`;
  const [prompt, setPrompt] = useState(() => { try { return record?.prompt || selection.prompt || localStorage.getItem(draftKey)?.slice(0, 400) || ''; } catch { return ''; } }), [key, setKey] = useState('');
  const [instrument, setInstrument] = useState(record?.instrument || selection.instrument || 'drums'), [rights, setRights] = useState(false);
  const [discardKey, setDiscardKey] = useState(null);
  const source = selection.source, asset = source?.asset;
  const region = selection.region || { start: selection.placement?.start, length: selection.placement?.length, phaseSec: selection.placement?.phaseSec, reverse: selection.placement?.reverse || false };
  const held = useSyncExternalStore(subscribeAssets, () => asset ? assetState(asset, doc.tempo.bpm) : idle, () => idle);
  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    gatewayFetch(`/music/songs/${source.songId}`, { signal: controller.signal }).then(setSong).catch(e => { if (!controller.signal.aborted) setSourceError(aiError(e, op)); });
    return () => controller.abort();
  }, [source, op]);
  useEffect(() => { request.reset(); }, [doc.tempo.bpm, doc.cycle.start, doc.cycle.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const promptNeeded = ['generate', 'extend', 'replace'].includes(op);
  let reason = record ? '' : op === 'generate' ? trackCapacity(doc) : sourceError || actionEligibility(op, doc, region, asset, song, held);
  let body;
  if (!reason && !record) {
    try { body = op === 'generate' ? generateBody(doc, prompt, key) : actionBody(op, { doc, region, asset, prompt, instrument, rights }); }
    catch (e) { reason = e.message; }
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
  return <dialog ref={dialog} aria-labelledby="beat-ai-title" onCancel={e => { e.preventDefault(); request.close(); }}
    className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-vx-border bg-vx-panel p-5 text-vx-fg backdrop:bg-vx-base/80 md:inset-y-0 md:left-auto md:right-0 md:max-h-dvh md:max-w-md md:rounded-none">
    <div className="flex items-center justify-between gap-3"><h2 id="beat-ai-title" className="text-xl font-bold"><span aria-hidden="true">✦ </span>{AI_LABELS[op]}</h2><button className={button} disabled={!!busy} onClick={request.close} aria-label="Close AI parts">Close</button></div>
    <p className="my-3 text-sm text-vx-fg-muted">See the exact price before Send. Results also stay in your Music library.</p>
    <fieldset disabled={!!busy || !!record} className="space-y-4">
      {promptNeeded && <label className="flex flex-col gap-2">Describe the part<textarea autoFocus className={`${input} min-h-28`} maxLength={400} value={prompt} placeholder="Warm Rhodes chords, laid-back" onChange={e => change(setPrompt, e.target.value)} aria-describedby="beat-ai-validation" /></label>}
      {op === 'generate' && <><label className="flex flex-col gap-2">Key<select className={input} value={key} onChange={e => change(setKey, e.target.value)}><option value="">Auto</option>{BEAT_AI_KEYS.map(k => <option key={k}>{k}</option>)}</select></label>
        <p>Bars {Math.floor(doc.cycle.start / 3840) + 1}–{Math.ceil(doc.cycle.end / 3840)} · {seconds.toFixed(1)} s</p></>}
      {op === 'targetStems' && <label className="flex flex-col gap-2">Instrument<select className={input} value={instrument} onChange={e => change(setInstrument, e.target.value)}>{AI_INSTRUMENTS.map(i => <option key={i}>{i}</option>)}</select></label>}
      {op !== 'generate' && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent" checked={rights} onChange={e => change(setRights, e.target.checked)} />I own or have permission to separate this recording.</label>}
    </fieldset>
    {!online && <p className="my-4" role="status">Generate needs a connection</p>}
    {reason && <p id="beat-ai-validation" className="my-4">{reason}</p>}
    {quote && <div className="my-4 rounded-xl border border-vx-border p-3"><p className="text-lg font-bold text-vx-money">{quote.total_credits} Credits</p><p>Balance {quote.balance} → {quote.balance_after}</p>
      {!quote.affordable && <p>Not enough Credits — <Link className="inline-flex min-h-11 items-center underline focus-visible:outline-vx-accent" href="/pricing">Buy Credits</Link></p>}</div>}
    <div className="my-4 flex flex-wrap gap-3">
      {!record && !quote && <button className={action} disabled={!!busy || !online || !!reason} onClick={price}>{busy || 'Price'}</button>}
      {(quote || record) && <button className={action} disabled={!!busy || !online || (!record && (!quote.affordable || !!reason))} onClick={request.send}>{busy || (record ? record.requestId ? 'Check again' : 'Try again — Check again' : 'Send')}</button>}
      {quote && !record && <button className={button} disabled={!!busy} onClick={request.reset}>Change</button>}
      {record && !record.requestId && discardKey !== record.key && <button className={button} disabled={!!busy} onClick={() => setDiscardKey(record.key)}>Discard request</button>}
    </div>
    {record && !record.requestId && discardKey === record.key && <div className="my-4 space-y-3" role="group" aria-label="Confirm discard request">
      <p role="status">Discard this request from the beat? This does not cancel a request already accepted. Any results will stay in your Music library.</p>
      <div className="flex flex-wrap gap-3"><button className={button} disabled={!!busy} onClick={request.discard}>Confirm discard</button>
        <button className={button} disabled={!!busy} onClick={() => setDiscardKey(null)}>Keep request</button></div>
    </div>}
    {request.elapsed >= 3 && <p role="status">{busy || 'Making parts…'} · {request.elapsed} s</p>}
    {request.message && <p className="my-3" role="status">{request.message}</p>}
    {request.error && <p className="my-3 text-vx-danger" role="alert">{request.error}</p>}
  </dialog>;
}
