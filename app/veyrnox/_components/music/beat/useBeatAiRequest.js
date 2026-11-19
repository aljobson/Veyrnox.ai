'use client';
import { assertBeatWritable, beatReadOnly, BEAT_READ_ONLY_MESSAGE, capabilityGeneration, assertBeatGeneration } from '../../../_lib/music/beat/beatCompatibility.mjs';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { beatFailure } from '../../../_lib/music/beat/beatErrors.mjs';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch, notifyBalanceChanged } from '../../../_lib/gateway.js';
import { AI_TERMINAL, aiError, aiPollPath } from '../../../_lib/music/beat/beatAi.mjs';
import { readPending, writePending, retirePending, placementIds, singleFlight, submitPending, definitivelyRefused } from '../../../_lib/music/beat/beatAiPending.mjs';
import { placeAiResults, placedAlready } from '../../../_lib/music/beat/beatAiOps.mjs';
import { loadAiResults } from '../../../_lib/music/beat/beatAiResults.js';

export function useBeatAiRequest({ beatId, project, announce, enabled }) {
  const { t } = useI18n();
  const [selection, setSelection] = useState(null), [record, setRecord] = useState(null), [pending, setPending] = useState([]);
  const [quote, setQuote] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [message, setMessage] = useState(''), [online, setOnline] = useState(true), [elapsed, setElapsed] = useState(0);
  const live = useRef(true), gate = useRef(singleFlight()), quoteRef = useRef(null), recordRef = useRef(null);
  const current = useRef({ project, announce });
  useEffect(() => { current.current = { project, announce }; }, [project, announce]);
  const refreshPending = useCallback(() => setPending(readPending(beatId)), [beatId]);
  useEffect(() => {
    live.current = true;
    if (!enabled) return;
    queueMicrotask(() => { if (live.current) refreshPending(); });
    const network = () => setOnline(navigator.onLine !== false);
    queueMicrotask(() => { if (live.current) network(); }); window.addEventListener('online', network); window.addEventListener('offline', network);
    return () => { live.current = false; window.removeEventListener('online', network); window.removeEventListener('offline', network); };
  }, [beatId, enabled, refreshPending]);
  const say = useCallback(text => { if (live.current) { setMessage(text); current.current.announce(text); } }, []);
  const fail = useCallback((e, op = recordRef.current?.op) => { if (live.current) { const text = e?.code === 'v5_write_disabled' ? t(BEAT_READ_ONLY_MESSAGE) : aiError(e, op, t); setError(text); current.current.announce(text); } }, [t]);
  function keep(next) { writePending(beatId, next); recordRef.current = next; if (live.current) setRecord(next); refreshPending(); }
  function clearRequest(r) {
    retirePending(beatId, r.key); refreshPending();
    recordRef.current = null; quoteRef.current = null;
    if (live.current) { setRecord(null); setQuote(null); setMessage(''); setError(''); }
  }
  function discard() {
    return gate.current(() => {
      const r = recordRef.current;
      if (!r || r.requestId) return;
      try { clearRequest(r); say(t('app.music.beat.status.s104')); }
      catch (e) { fail(e); }
    });
  }
  const refresh = useCallback(async r => {
    const status = await gatewayFetch(aiPollPath(r)); // Resume is GET-only, even without an acknowledgement.
    if (!live.current || recordRef.current?.key !== r.key) return;
    if (!AI_TERMINAL.has(status.state)) {
      say((status.candidates || []).map(c => t('app.music.beat.status.s105', { p0: c.ordinal === 1 ? 'A' : 'B', p1: tOr(t, `app.music.beat.shared.state.${c.state}`, t('app.music.beat.shared.state.unknown')) })).join(' · ') || t('app.music.beat.status.s106')); return;
    }
    const { project } = current.current;
    const { results, messages } = await loadAiResults(r, status, project.current?.current, t);
    if (!live.current || recordRef.current?.key !== r.key) return;
    if (results.length && beatReadOnly(project.current?.current)) { say(t(BEAT_READ_ONLY_MESSAGE)); return; }
    if (results.length) {
      const sourceGone = r.placement.sourceTrackId && !project.current?.current.tracks.some(t => t.id === r.placement.sourceTrackId && t.regions.some(region => region.id === r.placement.regionId));
      const already = results.every(item => placedAlready(project.current?.current, r, item.ordinal));
      if (!already && !project.edit(d => placeAiResults(d, r, results), { label: BEAT_ACTIONS.a39, message: r.source && !sourceGone ? t('app.music.beat.status.s74') : t('app.music.beat.status.s75') }))
        throw beatFailure('recovery-r13');
      const placed = project.current?.current;
      await project.flushLatest();
      if (!live.current || project.current?.current !== placed || !results.every(item => placedAlready(placed, r, item.ordinal)))
        throw beatFailure('recovery-r14');
      say([t('app.music.beat.status.s107', { p0: r.prompt.slice(0, 24) || t('app.music.beat.details.d43'), p1: Number.isFinite(r.credits) ? t('app.music.beat.status.s108', { p0: r.credits }) : '', p2: Number.isFinite(r.balanceAfter) ? t('app.music.beat.status.s109', { p0: r.balanceAfter }) : '' }),
        r.source && !sourceGone ? t('app.music.beat.status.s74') : '', sourceGone ? t('app.music.beat.status.s110') : '', ...messages].filter(Boolean).join('. '));
    } else say(messages.join('. ') || t('app.music.beat.status.s111'));
    retirePending(beatId, r.key); refreshPending();
    recordRef.current = null; setRecord(null); setQuote(null); quoteRef.current = null; notifyBalanceChanged();
  }, [beatId, refreshPending, say, t]);
  useEffect(() => {
    if (!selection || !record?.requestId || !online || error) return;
    let cancelled = false, timer;
    const poll = () => {
      if (cancelled) return;
      if (!document.hidden) gate.current(async () => { try { await refresh(record); } catch (e) { fail(e); } }).finally(() => { if (!cancelled) timer = setTimeout(poll, 1500); });
      else timer = setTimeout(poll, 1500);
    };
    poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [record, selection, online, error, refresh, fail]);
  useEffect(() => {
    if (!busy && !record?.requestId) return;
    const start = Date.now(), timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy, record?.requestId]);
  function open(next, resumed = null) {
    quoteRef.current = null; setQuote(null); recordRef.current = resumed; setRecord(resumed);
    setSelection(next); setError(''); setMessage(resumed && !resumed.requestId ? t('app.music.beat.status.s76') : '');
  }
  function resume(r) { open({ op: r.op, source: r.source, placement: r.placement, prompt: r.prompt, instrument: r.instrument }, r); }
  function reset() { if (recordRef.current) return; quoteRef.current = null; setQuote(null); setError(''); }
  function price(path, body, draft) {
    return gate.current(async () => {
      if (!online || recordRef.current) return;
      setBusy(t('app.music.beat.ui.pricing')); setElapsed(0); setError('');
      try {
        assertBeatWritable(current.current.project.current?.current);
        const result = await gatewayFetch(path, { method: 'POST', body: JSON.stringify(body) });
        if (!live.current) return;
        const key = `beat-ai.${crypto.randomUUID()}`;
        const next = { ...draft, quoteId: result.quote_id, key, placementIds: placementIds(key), state: 'pending', createdAt: Date.now(), credits: result.total_credits };
        quoteRef.current = { result, record: next }; setQuote(result); say(t('app.music.beat.status.s112', { p0: result.total_credits }));
      } catch (e) { fail(e); } finally { if (live.current) setBusy(''); }
    });
  }
  function send() {
    return gate.current(async () => {
      if (!online) return;
      const r = recordRef.current || quoteRef.current?.record;
      if (!r || (!recordRef.current && quoteRef.current?.result.affordable !== true)) return;
      if (r.requestId) { setError(''); try { await refresh(r); } catch (e) { fail(e); } return; }
      setBusy(t('app.music.beat.shared.sending')); setElapsed(0); setError('');
      try {
        assertBeatWritable(current.current.project.current?.current);
        keep(r); // If durable storage fails, there is no POST.
        const generation = capabilityGeneration();
        const beforeSend = () => { assertBeatGeneration(generation); assertBeatWritable(current.current.project.current?.current); };
        let result;
        try { result = await submitPending(r, (path, init) => gatewayFetch(path, { ...init, beforeSend })); }
        catch (e) { if (definitivelyRefused(e)) clearRequest(r); throw e; }
        const next = { ...r, requestId: result.generation_id || result.request_id, state: 'accepted', balanceAfter: result.balance_after };
        keep(next); notifyBalanceChanged(); say(t('app.music.beat.status.s106'));
      } catch (e) { fail(e, r.op); } finally { if (live.current) setBusy(''); }
    });
  }
  return { readOnly: beatReadOnly(project.current?.current), selection, record, pending, quote, busy, error, message, online, elapsed: busy || record?.requestId ? elapsed : 0, open, resume, reset, price, send, discard,
    close: () => { if (!busy) setSelection(null); } };
}
