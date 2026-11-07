import { normaliseScribeResult, parseSmartCutAnalysis } from '../app/veyrnox/_lib/smartCutAnalysis.js';
import { verifySpeechCorrelation } from './speechCutCorrelation.js';
/** Signature is already verified by the parent fal handler. Never persist the event body. */
export async function speechAnalysisWebhook({ req, known, event, requestId, byteSize, cfg, rpcCall, fetchCall, secret }) {
    const query = new URL(req.url).searchParams;
    const hasToken = query.has('speech_token');
    if (!hasToken && known?.inputs?.kind !== 'speech_analysis') return null;
    const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    const jobId = hasToken ? query.get('job_id') : known.id;
    if (hasToken && (!await verifySpeechCorrelation(jobId, query.get('speech_token'), secret) || (known && known.id !== jobId))) return json({ error: 'invalid_correlation' }, 401);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(requestId || '')) return json({ error: 'invalid_request_id' }, 400);
    const headers = { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}`, 'Content-Type': 'application/json' };
    const call = (name, args) => rpcCall(name, args, cfg);
    try {
        const context = await call('speech_analysis_callback', { p_job_id: jobId, p_provider_request_id: requestId });
        if (!context?.ok) return json({ error: 'callback_unavailable' }, 503);
        const status = ['OK', 'SUCCESS', 'completed'].includes(event.status) && !event.error ? 'completed'
            : ['ERROR', 'failed'].includes(event.status) || event.error ? 'failed' : 'pending';
        if (status === 'pending') return json({ ok: true });
        const url = new URL('/rest/v1/webhook_events', cfg.supabaseUrl);
        url.searchParams.set('on_conflict', 'source,external_id');
        const insert = await fetchCall(url, { method: 'POST', headers: { ...headers, Prefer: 'return=representation,resolution=ignore-duplicates' },
            body: JSON.stringify({ source: 'fal', external_id: requestId, payload: { request_id: requestId, status, byte_size: byteSize } }) });
        if (!insert.ok) return json({ error: 'callback_unavailable' }, 503);
        const rows = await insert.json();
        const filter = `/rest/v1/webhook_events?source=eq.fal&external_id=eq.${encodeURIComponent(requestId)}`;
        if (Array.isArray(rows) && !rows.length) {
            const previous = await fetchCall(new URL(`${filter}&select=processed_at`, cfg.supabaseUrl), { headers });
            if (!previous.ok) return json({ error: 'callback_unavailable' }, 503);
            const records = await previous.json();
            if (records?.[0]?.processed_at) return json({ ok: true, duplicate: true });
        }
        if (!context.closed) {
            let parsed;
            if (status === 'completed') {
                const normalized = normaliseScribeResult({ assetId: context.assetId, duration: Number(context.duration), result: event.payload || event.output });
                parsed = normalized.ok ? parseSmartCutAnalysis(normalized.analysis, { assetId: context.assetId, duration: Number(context.duration) }) : normalized;
            }
            const result = parsed?.ok
                ? await call('speech_analysis_complete', { p_job_id: jobId, p_analysis: parsed.analysis })
                : await call('speech_analysis_fail', { p_job_id: jobId, p_code: status === 'failed' ? 'provider_failed' : parsed?.error === 'analysis_no_speech' ? 'analysis_no_speech' : 'analysis_invalid' });
            if (result?.ok !== true) return json({ error: 'settlement_unavailable' }, 503);
        }
        const marked = await fetchCall(new URL(filter, cfg.supabaseUrl), { method: 'PATCH', headers, body: JSON.stringify({ processed_at: new Date().toISOString() }) });
        return marked.ok ? json({ ok: true }) : json({ error: 'callback_unavailable' }, 503);
    } catch { return json({ error: 'callback_unavailable' }, 503); }
}
