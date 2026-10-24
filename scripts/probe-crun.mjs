#!/usr/bin/env node
/**
 * One paid probe of Crun (ADR-0256 phase 5), through the same adapter the
 * Worker would use. PROD KEY, REAL MONEY: each run spends the price shown.
 *
 *   read -s "CRUN_API_KEY?Crun key: "; export CRUN_API_KEY
 *   node scripts/probe-crun.mjs veo-lite          # about $0.067
 *   node scripts/probe-crun.mjs veo-fast          # about $0.134
 *   node scripts/probe-crun.mjs seedance-fast     # about $0.29
 *   node scripts/probe-crun.mjs veo --yes         # about $1.00, needs --yes
 *   unset CRUN_API_KEY
 *
 * The key is read from the environment only, never from an argument, and is
 * never printed. The script prints what the parity record needs: the task id,
 * the status words Crun used, the credits it charged, the time taken, and the
 * output's host, type and size. It does not download or keep the video.
 *
 * It does not touch Veyrnox: no database, no jobs, no ledger.
 */
import { submitTask, fetchTask, parseEndpoint } from '../packages/adapters/crun.js';

const PROBES = {
    'veo-lite': { endpoint: 'crun:google/veo3-1-lite-t2v', usd: 0.067, inputs: { duration_seconds: 8 } },
    'veo-fast': { endpoint: 'crun:google/veo3-1-fast-t2v', usd: 0.134, inputs: { duration_seconds: 8 } },
    'seedance-fast': { endpoint: 'crun:bytedance/seedance2-0-fast-t2v', usd: 0.29, inputs: { duration_seconds: 5 } },
    veo: { endpoint: 'crun:google/veo3-1-t2v', usd: 1.0, inputs: { duration_seconds: 8 }, needsYes: true },
};
const POLL_MS = 5000;
const TIMEOUT_MS = 10 * 60 * 1000;

export function chooseProbe(argv) {
    const name = argv.find((a) => !a.startsWith('--'));
    const probe = PROBES[name];
    if (!probe) return { ok: false, error: `choose one of: ${Object.keys(PROBES).join(', ')}` };
    if (probe.needsYes && !argv.includes('--yes')) return { ok: false, error: `${name} costs about $${probe.usd.toFixed(2)}; add --yes to run it` };
    return { ok: true, name, probe };
}

async function main() {
    const chosen = chooseProbe(process.argv.slice(2));
    if (!chosen.ok) { console.error(chosen.error); process.exit(2); }
    const apiKey = process.env.CRUN_API_KEY;
    if (!apiKey || /^<.*>$/.test(apiKey)) { console.error('CRUN_API_KEY is not set (use the silent prompt in the header, not a placeholder)'); process.exit(2); }
    const { name, probe } = chosen;
    if (!parseEndpoint(probe.endpoint)) { console.error('endpoint no longer parses'); process.exit(2); }

    console.log(`probe ${name}: about $${probe.usd.toFixed(3)} on the PROD Crun key`);
    const started = Date.now();
    const sub = await submitTask({ job_id: `probe-${Date.now()}`, provider_endpoint: probe.endpoint, inputs: { prompt: 'a red paper boat drifting on calm water at dawn, soft light', ...probe.inputs } }, { apiKey });
    if (!sub.ok) { console.error('submit failed:', sub.outcome, sub.error); process.exit(1); }
    console.log('task id:', sub.providerJobId);

    const seen = new Set();
    while (Date.now() - started < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const t = await fetchTask(sub.providerJobId, { apiKey });
        if (!t.ok) { console.log('poll error:', t.error); continue; }
        if (!seen.has(t.state)) { seen.add(t.state); console.log(`state ${t.state} after ${Math.round((Date.now() - started) / 1000)} s`); }
        if (t.state === 'fail') { console.log('failed:', t.errorCode); process.exit(1); }
        if (t.state === 'success') {
            const u = new URL(t.outputUrl);
            const head = await fetch(t.outputUrl, { method: 'HEAD' }).catch(() => null);
            console.log('output host:', u.host);
            console.log('output type:', head && head.headers.get('content-type'), 'bytes:', head && head.headers.get('content-length'));
            console.log(`total ${Math.round((Date.now() - started) / 1000)} s. Now read the charge in crun.ai/logs and compare it with the table.`);
            return;
        }
    }
    console.error('timed out waiting for the task; read crun.ai/logs for its state');
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
