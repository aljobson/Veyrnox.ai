'use client';
import { useState } from 'react';
import { musicStudioProposalCurrent, planMusicStudioAction } from '../../../../../lib/musicStudioActions.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { pluralKey } from '../../../../../lib/i18n/translate.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { action, button, input } from './beatStyles';

const key = (code) => `app.music.beat.assistant.${code}`;

export default function BeatStudioAssistant({ doc, magicBar, readOnly, recording, busy, edit, selectPattern, announce }) {
  const { locale, t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const visibleResult = result?.kind === 'proposal' && !musicStudioProposalCurrent(result, doc)
    ? { kind: 'error', code: 'changed', messageKey: 'studioAssistant.changed', params: {} } : result;

  const message = (entry) => {
    const params = { ...entry.params };
    if ('value' in params && (params.value === 'on' || params.value === 'off')) params.value = t(key(`value_${params.value}`));
    if ('view' in params && (params.view === 'song' || params.view === 'pattern')) params.view = t(`app.music.beat.ui.${params.view === 'song' ? 'song' : 'pattern.2'}`);
    if ('value' in params && (params.value === 'song' || params.value === 'pattern')) params.value = t(`app.music.beat.ui.${params.value === 'song' ? 'song' : 'pattern.2'}`);
    return entry.code === 'tracks' ? t(pluralKey(t, locale, key('tracks'), Number(params.count)), params) : t(key(entry.code), params);
  };
  const ask = (event) => {
    event.preventDefault();
    const planned = planMusicStudioAction({ input: prompt, document: doc, capabilities: { studioChat: true, magicBar }, editability: { readOnly, recording, busy } });
    if (result && result.kind !== 'proposal') setHistory(items => [...items.slice(-5), result]);
    setResult(planned);
  };
  const cancel = () => setResult(null);
  const apply = () => {
    if (result?.kind !== 'proposal' || !musicStudioProposalCurrent(result, doc)) {
      const changed = { kind: 'error', code: 'changed', messageKey: 'studioAssistant.changed', params: {} };
      setResult(changed); return;
    }
    const operation = result.operation;
    if (readOnly || busy || (recording && !['set_track_mute', 'set_track_solo'].includes(operation.type))) return;
    const label = t(key('applied'));
    let applied = false;
    if (operation.type === 'set_tempo') applied = Boolean(edit(d => ops.setTempo(d, operation.bpm), { label, message: label }));
    if (operation.type === 'set_view') applied = Boolean(edit(d => ops.setView(d, operation.view), { label, message: label }));
    if (operation.type === 'set_track_mute') applied = Boolean(edit(d => ops.setTrackMute(d, operation.trackId, operation.value), { label, message: label, liveMix: true, trackId: operation.trackId }));
    if (operation.type === 'set_track_solo') applied = Boolean(edit(d => ops.setTrackSolo(d, operation.trackId, operation.value), { label, message: label, liveMix: true, trackId: operation.trackId }));
    if (operation.type === 'select_pattern') applied = selectPattern(operation.pattern) === true;
    if (!applied) return;
    const done = { kind: 'answer', code: 'applied', messageKey: 'studioAssistant.applied', params: {} };
    if (operation.type === 'select_pattern') announce(label);
    setResult(done);
  };
  const liveMix = visibleResult?.kind === 'proposal' && ['set_track_mute', 'set_track_solo'].includes(visibleResult.operation.type);
  const applyBlocked = readOnly || busy || (recording && !liveMix);
  const questionAnswer = visibleResult?.kind === 'answer' && ['help', 'tempo', 'view', 'tracks'].includes(visibleResult.code);
  const visibleMessage = visibleResult ? <>{message(visibleResult)}{visibleResult.code === 'tracks' && visibleResult.tracks?.map(track => <span className="block" key={track.index}>{t(key('track_line'), { ...track, mute: t(key(track.mute ? 'state_yes' : 'state_no')), solo: t(key(track.solo ? 'state_yes' : 'state_no')) })}</span>)}</> : null;
  return <section data-testid="beat-studio-assistant" className="space-y-3 rounded-2xl border border-vx-border bg-vx-panel p-4" aria-labelledby="beat-studio-assistant-title">
    <div><h2 id="beat-studio-assistant-title" className="text-lg font-black">{t(key('title'))}</h2><p className="text-sm text-vx-fg-muted">{t(key('body'))}</p></div>
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={ask}>
      <label className="flex min-w-0 flex-1 flex-col gap-1">{t(key('prompt'))}<input data-beat-read data-beat-live className={input} maxLength={200} value={prompt} placeholder={t(key('placeholder'))} onChange={event => setPrompt(event.target.value)} /></label>
      <button data-beat-read data-beat-live className={`${button} self-end`} disabled={!prompt.trim()} type="submit">{t(key('ask'))}</button>
    </form>
    {history.length ? <ol className="space-y-1 text-sm text-vx-fg-muted" aria-label={t(key('title'))}>{history.map((entry, index) => <li key={`${index}-${entry.code}`}>{message(entry)}{entry.code === 'tracks' && entry.tracks?.map(track => <span className="block" key={track.index}>{t(key('track_line'), { ...track, mute: t(key(track.mute ? 'state_yes' : 'state_no')), solo: t(key(track.solo ? 'state_yes' : 'state_no')) })}</span>)}</li>)}</ol> : null}
    {visibleResult?.kind === 'proposal' ? <div className="space-y-2 rounded-xl border border-vx-accent/50 bg-vx-base p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-vx-accent">{t(key('local'))}</p><p>{message(visibleResult)}</p>
      <div className="flex flex-wrap gap-2"><button {...(liveMix ? { 'data-beat-live': true } : {})} className={action} disabled={applyBlocked} onClick={apply} type="button">{t(key('apply'))}</button><button data-beat-read data-beat-live className={button} onClick={cancel} type="button">{t(key('cancel'))}</button></div>
    </div> : visibleResult && !questionAnswer ? <p className="text-sm">{visibleMessage}</p> : null}
    <p role="status" className={questionAnswer ? 'text-sm' : 'sr-only'}>{questionAnswer ? visibleMessage : null}</p>
  </section>;
}
