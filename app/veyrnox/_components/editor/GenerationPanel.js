'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { LibraryPicker } from '../LibraryPicker';
import { useCatalog } from '../../_lib/useCatalog';
import { useStudioJobs } from '../../_lib/useStudioJobs';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../../_lib/gateway';
import { getSession, onSessionChange } from '../../../lib/authClient';
import { pushJobHistory } from '../../_lib/jobHistory';
import { loadLibraryBlob } from '../../_lib/editorLibrary.mjs';
import { libraryMediaId } from '../../_lib/editorMedia.mjs';
import { generationInputs, generationQuote } from '../../_lib/editorGeneration.mjs';
export function GenerationPanel({ disabled, onIngest }) {
    const catalog = useCatalog(), models = catalog.models.filter(m => !m.gated && !m.isEdit && !m.takesTopic && !m.takesPlan && m.takesPrompt && Object.keys(m.media || {}).every(slot => ['image', 'video', 'audio'].includes(slot)));
    const [modelId, setModelId] = useState(''), [prompt, setPrompt] = useState(''), [duration, setDuration] = useState(5), [aspect, setAspect] = useState('16:9'), [voice, setVoice] = useState('');
    const [sources, setSources] = useState({}), [libraryFor, setLibraryFor] = useState(null), [consent, setConsent] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState(''), [balance, setBalance] = useState(null), [freeLeft, setFreeLeft] = useState({}), [adding, setAdding] = useState(false);
    const pending = useRef(null), sent = useRef(false), alive = useRef(true);
    const { jobs, generating, startJobs, clearJobs } = useStudioJobs({ onUnreachable: () => setError('Job status is unavailable. Open your Library to recover the result; the job keeps running.') });
    const model = models.find(m => m.id === modelId) || models[0], media = model?.media || {}, selectedDuration = model?.durations.includes(duration) ? duration : model?.durations[0] || 5, selectedAspect = model?.aspects?.includes(aspect) ? aspect : model?.aspects?.[0] || '16:9', quote = generationQuote(model, selectedDuration), free = (freeLeft[model?.id] || 0) > 0, locked = disabled || sending || generating || adding;
    const loadBalance = useCallback(() => {
        const owner = getSession()?.user?.id; if (!owner) return;
        Promise.all([gatewayFetch('/balance'), gatewayFetch('/free-allowance').catch(() => null)]).then(([balance, allowance]) => {
            if (alive.current && getSession()?.user?.id === owner) { setBalance(balance.balance); setFreeLeft(allowance?.enabled ? allowance.left || {} : {}); }
        }, () => { if (alive.current && getSession()?.user?.id === owner) setBalance(null); });
    }, []);
    useEffect(() => { alive.current = true; loadBalance(); const off = onSessionChange(() => { clearJobs(); pending.current = null; setSources({}); setPrompt(''); setVoice(''); setConsent(false); setFreeLeft({}); setBalance(null); loadBalance(); }); window.addEventListener('veyrnox:balance-changed', loadBalance); return () => { alive.current = false; off(); window.removeEventListener('veyrnox:balance-changed', loadBalance); }; }, [clearJobs, loadBalance]);
    function pick(slot, asset) { setSources(previous => ({ ...previous, [slot]: { assetId: asset.id, previewUrl: asset.url, label: asset.label } })); setConsent(false); }
    async function generate() {
        if (sent.current || locked || !catalog.live || !model || quote === null) return;
        if (!getSession()) { window.dispatchEvent(new CustomEvent('veyrnox:auth-required')); return; }
        const prepared = generationInputs(model, { prompt, duration: selectedDuration, aspect: selectedAspect, voice }); if (prepared.error) { setError(prepared.error); return; }
        if (Object.entries(media).some(([slot, spec]) => spec.required && !sources[slot])) { setError('Choose the required source files.'); return; }
        const active = Object.keys(media).filter(slot => sources[slot]); if (active.length && !consent) { setError('Confirm the source permission statement.'); return; }
        if (balance == null || (!free && quote > balance)) { setError(balance == null ? 'Refresh your balance before generating.' : 'You need more credits for this generation.'); return; }
        const owner = getSession()?.user?.id; if (!owner) { setError('Sign in before generating.'); return; } sent.current = true; setSending(true); setError('');
        const signature = JSON.stringify({ model: model.id, inputs: prepared.inputs, sources: active.map(slot => sources[slot].assetId) });
        try {
            if (pending.current?.signature !== signature) pending.current = { signature, key: makeIdempotencyKey(), body: null };
            if (!pending.current.body) pending.current.body = { model_id: model.id, idempotency_key: pending.current.key, inputs: prepared.inputs, ...(active.length ? { source_assets: active.map(slot => sources[slot].assetId), consent: true } : {}) };
            if (getSession()?.user?.id !== owner) throw new Error('Account changed.');
            const r = await gatewayFetch('/generations', { method: 'POST', body: JSON.stringify(pending.current.body) }); const credits = r.free_allowance ? 0 : quote;
            if (!alive.current || getSession()?.user?.id !== owner) return;
            pushJobHistory({ job_id: r.job_id, model_id: model.id, credits, name: prompt.slice(0, 40) }); pending.current = null;
            if (alive.current) { startJobs({ job_id: r.job_id, state: 'queued', model_id: model.id, credits }); if (r.balance_after != null) setBalance(r.balance_after); } notifyBalanceChanged();
        } catch (e) { if (alive.current) setError(e.code === 'account_paused' ? 'Your account is paused. Library downloads remain available.' : e.status === 429 ? 'Too many requests. Wait before retrying.' : 'Generation could not be confirmed. Retry unchanged to reuse the same request, or recover it from your Library.'); }
        finally { sent.current = false; if (alive.current) setSending(false); }
    }
    async function addResult(job) { const owner = getSession()?.user?.id; if (!owner) return; setAdding(true); try { const { blob } = await loadLibraryBlob(gatewayFetch, job.job_id); if (!alive.current || getSession()?.user?.id !== owner) return; await onIngest(blob, `${models.find(m => m.id === job.model_id)?.name || 'Generated'} result`, libraryMediaId(job.job_id)); } catch (e) { setError(e.message || 'Could not add this result. Retry from your Library.'); } finally { if (alive.current) setAdding(false); } }
    const field = 'w-full rounded border border-vx-border bg-vx-base p-2 text-xs';
    return <section aria-label="Generate media" className="space-y-3"><h2 className="text-sm font-bold">Generate media</h2>{!catalog.live && <p role="status" className="text-xs">Live pricing unavailable. Generation stays off until the catalog is available.</p>}<fieldset disabled={locked} className="space-y-2"><select aria-label="Generation model" className={field} value={model?.id || ''} onChange={e => { const next = models.find(m => m.id === e.target.value); setModelId(next.id); setDuration(next.durations[0] || 5); setAspect(next.aspects?.[0] || '16:9'); setConsent(false); }}>{models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.kind}</option>)}</select><textarea aria-label="Generation prompt" placeholder="Describe the media to create" className={field} maxLength={model?.promptMax || 2000} rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} />{model?.kind === 'video' && <select aria-label="Generation duration" className={field} value={selectedDuration} onChange={e => setDuration(Number(e.target.value))}>{model.durations.map(n => <option key={n} value={n}>{n}s</option>)}</select>}{model?.aspects?.length > 0 && <select aria-label="Generation shape" className={field} value={selectedAspect} onChange={e => setAspect(e.target.value)}>{model.aspects.map(a => <option key={a}>{a}</option>)}</select>}{model?.takesVoice && <textarea aria-label="Voice description" className={field} rows={2} maxLength={500} value={voice} onChange={e => setVoice(e.target.value)} placeholder="Describe the voice" />}
    {Object.entries(media).map(([slot, spec]) => <div key={slot} className="space-y-1 text-xs"><p>{slot} source{spec.required ? ' · required' : ' · optional'}</p><Button size="sm" variant="ghost" onClick={() => setLibraryFor(slot)}>{sources[slot]?.label || `Choose Library ${slot}`}</Button>{sources[slot] && <Button size="sm" variant="ghost" onClick={() => { setSources(previous => { const next = { ...previous }; delete next[slot]; return next; }); setConsent(false); }}>Clear {slot} source</Button>}</div>)}{Object.keys(media).some(slot => sources[slot]) && <label className="block text-xs"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I own this file, or I have the permission of everyone identifiable in it. No real person’s face, body or voice is used without their consent, and I hold the rights to any brand, artwork or recording in it (<a href="/legal/aup" className="underline">Acceptable Use</a>). This statement is recorded against the generation and your account.</label>}
    {catalog.live && <p role="status" className="text-xs">{free ? '0 credits · free generation available' : `${quote ?? '—'} credits`} · Balance {balance ?? 'unavailable'}</p>}<Button size="sm" disabled={!catalog.live || !model || quote === null || !prompt.trim()} onClick={generate}>{sending ? 'Submitting…' : 'Generate'}</Button><Button size="sm" variant="ghost" onClick={loadBalance}>Refresh balance</Button></fieldset>
    {error && <p role="alert" className="text-xs">{error}</p>}{jobs.map(job => <div key={job.job_id} className="space-y-2 rounded border border-vx-border p-2 text-xs"><p role="status">{job.state} · {job.credits} credits</p>{job.state === 'succeeded' && <Button size="sm" disabled={adding || disabled} onClick={() => addResult(job)}>Add generated result</Button>}{job.state === 'failed' && <p>Generation failed. Refunds follow the normal job policy. Edit the prompt and generate again, or retry from your Library.</p>}</div>)}{libraryFor && <LibraryPicker kind={libraryFor} onClose={() => setLibraryFor(null)} onPick={asset => { pick(libraryFor, asset); setLibraryFor(null); }} />}<p className="text-[10px] text-vx-fg-muted">Use your existing Library media as generation sources. Closing this panel leaves accepted jobs running; completed media remains in your Library.</p></section>;
}
