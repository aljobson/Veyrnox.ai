import { pathToFileURL } from 'node:url';

export async function checkFalDispatchStaging(env = process.env, fetcher = fetch) {
    for (const name of ['CLOUDFLARE_API_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'FAL_KEY']) {
        if (!env[name]?.trim()) throw new Error(`Missing protected staging secret: ${name}`);
    }
    // A production key cannot authorize this staging-only endpoint. The UUID
    // is deliberately nonexistent; this checks RPC access without spending.
    const response = await fetcher('https://yrqzwqywxfesmbvhzjgj.supabase.co/rest/v1/rpc/claim_fal_dispatch', {
        method: 'POST',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json' },
        body: JSON.stringify({ p_job_id: '00000000-0000-4000-8000-000000000000' }),
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Staging claim prerequisite failed: HTTP ${response.status}`);
    const answer = await response.json();
    if (answer?.disposition !== 'MISSING') throw new Error('Unexpected staging prerequisite result');
    return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { await checkFalDispatchStaging(); console.log('Staging consumer prerequisites passed; no provider call.'); }
    catch { console.error('Staging prerequisites failed; verify protected secrets and migration 0231.'); process.exitCode = 1; }
}
