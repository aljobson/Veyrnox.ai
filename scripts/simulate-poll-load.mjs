#!/usr/bin/env node
/**
 * Local load simulation for the two completion paths of providers with no signed callback (GrsAI, BytePlus,
 * Crun, Higgsfield): check-on-read (lib/refreshPolledJob.js) and the minute sweep (lib/byteplusSweep.js).
 * It runs the REAL modules with a fake provider and a fake database. No network, no credentials, no writes.
 *
 *   node scripts/simulate-poll-load.mjs                 both parts, defaults
 *   node scripts/simulate-poll-load.mjs --jobs=10000 --isolates=100 --seconds=20
 *
 * What it measures: how many provider checks and jobs queries the code would issue, not how Supabase,
 * Cloudflare or a provider cope with them. It says nothing about network latency, CPU or memory limits.
 *
 * Part A, check-on-read: J jobs in flight, each polled every 2 s (the web UI) by a client whose request lands on a
 *   random isolate (each isolate is its own copy of the module, so its own throttle map and concurrency counter).
 * Part B, minute sweep: more pending jobs than the 50-job batch, the oldest of which the provider has not finished.
 */
import { pathToFileURL } from 'node:url';
import { sweepByteplus, BATCH } from '../lib/byteplusSweep.js';

const args = process.argv.slice(2);
const num = (name, dflt) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.slice(name.length + 3)) : dflt; };
const SECONDS = num('seconds', 20);
const POLL_MS = 2000;
const CHECK_LATENCY_MS = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isolateModule(i) {
    return import(`${pathToFileURL(new URL('../lib/refreshPolledJob.js', import.meta.url).pathname).href}?iso=${i}`);
}

async function partA({ jobs, isolates, shared: sharedOn }) {
    const mods = await Promise.all(Array.from({ length: isolates }, (_, i) => isolateModule(i)));
    let reached = 0, inflight = 0, peakInflight = 0;
    const perSecond = new Map();
    const sweeps = { byteplus: [async () => {
        reached += 1; inflight += 1; peakInflight = Math.max(peakInflight, inflight);
        const s = Math.floor((Date.now() - start) / 1000);
        perSecond.set(s, (perSecond.get(s) || 0) + 1);
        await sleep(CHECK_LATENCY_MS);
        inflight -= 1;
        return { applied: 0 };
    }, 'BYTEPLUS_API_KEY', null] };
    const env = { BYTEPLUS_API_KEY: 'k' };
    // One fake Cache API for every isolate (one data centre), with the claim's own time-to-live.
    const cache = new Map();
    const shared = sharedOn
        ? { claim: async (id, seconds) => { const until = cache.get(id); if (until && until > Date.now()) return false; cache.set(id, Date.now() + seconds * 1000); return true; } }
        : { claim: async () => true };
    const start = Date.now();
    // Steady state: ages spread over 0 to 120 s, so about three quarters are past the 30 s minimum age.
    const list = Array.from({ length: jobs }, (_, n) => ({
        id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
        createdAt: start - Math.random() * 120_000,
        next: start + Math.random() * POLL_MS,
    }));
    let polls = 0;
    while (Date.now() - start < SECONDS * 1000) {
        const now = Date.now();
        for (const j of list) {
            if (j.next > now) continue;
            j.next += POLL_MS;
            polls += 1;
            const mod = mods[Math.floor(Math.random() * isolates)];
            mod.refreshPolledJob({ job: { id: j.id, provider: 'byteplus', state: 'SUBMITTED', created_at: new Date(j.createdAt).toISOString() },
                cfg: {}, env, sweeps, r2cfg: {}, now, shared });
        }
        await sleep(50);
    }
    await sleep(CHECK_LATENCY_MS * 2);
    const seconds = [...perSecond.entries()].filter(([s]) => s >= 2 && s < SECONDS - 1).map(([, v]) => v);
    return { polls, reached, perSecAvg: seconds.length ? Math.round(seconds.reduce((a, b) => a + b, 0) / seconds.length) : 0, perSecPeak: Math.max(0, ...seconds), peakInflight, pollsPerSec: Math.round(polls / SECONDS) };
}

/** Fake Supabase for the sweep: serves the model catalog and the jobs table the way PostgREST would. */
function fakeDatabase(rows) {
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith('/model_catalog')) return Response.json([{ id: 'seedance-2.0-fast-byteplus', provider_endpoint: 'byteplus:seedance-2.0-fast' }]);
        if (u.pathname.endsWith('/jobs')) {
            const limit = Number(u.searchParams.get('limit') || 50);
            const only = u.searchParams.get('id');
            const offset = Number(u.searchParams.get('offset') || 0);
            const picked = rows.filter((r) => r.open && (!only || only === `eq.${r.id}`)).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(offset, offset + limit);
            return Response.json(picked);
        }
        return Response.json([]);
    };
    return () => { globalThis.fetch = real; };
}

async function partB({ total, stuck, sweeps }) {
    const now = new Date('2026-11-19T12:00:00Z');
    const rows = Array.from({ length: total }, (_, n) => ({
        id: `11111111-0000-0000-0000-${String(n).padStart(12, '0')}`, user_id: 'u', credits: 29, state: 'SUBMITTED', open: true,
        provider_job_id: `task-${n}`, created_at: new Date(+now - (total - n) * 1000 - 120_000).toISOString(),
    }));
    // The oldest `stuck` jobs are still rendering at the provider; every later one is already finished.
    const finishedAtProvider = (taskId) => Number(taskId.slice(5)) >= stuck;
    const restore = fakeDatabase(rows);
    const settled = new Set();
    const read = async (taskId) => (finishedAtProvider(taskId) ? { ok: true, state: 'success', outputUrl: 'https://provider.test/x.mp4' } : { ok: true, state: 'pending' });
    const complete = async ({ job }) => { settled.add(job.id); rows.find((r) => r.id === job.id).open = false; return { status: 200, body: {} }; };
    const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'k' };
    const r2cfg = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
    const history = [];
    try {
        for (let i = 0; i < sweeps; i++) {
            await sweepByteplus({ cfg, r2cfg, apiKey: 'k', now: new Date(+now + i * 60_000), read, complete });
            history.push(settled.size);
        }
    } finally { restore(); }
    const finished = total - stuck;
    return { total, stuck, finished, settledAfter: history, waiting: finished - settled.size };
}

async function main() {
    if (!args.includes('--part=b')) await runPartA();
    await runPartB();
}

async function runPartA() {
    console.log('PART A  check-on-read (the real refreshPolledJob, a fake provider that answers in 150 ms), each job polled every 2 s');
    console.log('  jobs  isolates  shared throttle  polls/s  provider checks/s (avg, peak)  checks per job per min  peak in flight  checks/polls');
    const big = num('jobs', 10000);
    const cases = [];
    for (const [jobs, isolates] of [[1000, 100], [big, 1], [big, 20], [big, num('isolates', 100)]]) {
        cases.push({ jobs, isolates, shared: false }, { jobs, isolates, shared: true });
    }
    for (const c of cases) {
        const r = await partA(c);
        console.log(`  ${String(c.jobs).padStart(5)}  ${String(c.isolates).padStart(8)}  ${(c.shared ? 'on' : 'off').padStart(15)}  ${String(r.pollsPerSec).padStart(7)}  ${String(r.perSecAvg).padStart(10)}, ${String(r.perSecPeak).padStart(6)}`
            + `                ${(r.perSecAvg * 60 / c.jobs).toFixed(1).padStart(8)}                 ${String(r.peakInflight).padStart(6)}      ${((r.reached / Math.max(1, r.polls)) * 100).toFixed(0)}%`);
    }
    const eligible = 0.75;
    console.log(`  Design target (throttle works): about ${Math.round(10000 * eligible / 13.5)} checks/s at 10,000 jobs; ${Math.round(100000 * eligible / 13.5)} at 100,000.`);
}

async function runPartB() {
    console.log('');
    console.log(`PART B  minute sweep (half the batch oldest, half a moving window), the real sweepByteplus with a fake database`);
    for (const c of [{ total: 300, stuck: 30 }, { total: 300, stuck: 60 }, { total: 1000, stuck: 200 }]) {
        const r = await partB({ ...c, sweeps: 12 });
        console.log(`  ${c.total} pending, oldest ${c.stuck} still rendering: finished ${r.finished}; settled after sweeps 3, 6, 9, 12 = ${[2, 5, 8, 11].map((i) => r.settledAfter[i]).join(', ')}; still waiting ${r.waiting}`);
    }
}

main();
