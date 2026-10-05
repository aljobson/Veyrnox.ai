#!/usr/bin/env node
/**
 * Measure what one Deep research run costs (ADR-0070), so the price can be recorded before any row offers it.
 *
 * A run is the fixed plan the ADR describes: PLAN (the model writes up to 4 search queries), SEARCH (up to 4
 * web-plugin calls, 3 results each, the same shape and fee as today's Web search), WRITE (one cited answer at the
 * row's Thinking setting). This script runs that exact shape on each model for a few fixed questions and prints each
 * step's tokens and cost, then the worst case seen: plan + 4 x search + write, which is what
 * `chat_research_extra_cost` would record. It writes nothing to the catalog.
 *
 *   PLAN   (default, free)  Print the models, questions, steps and caps. No network, nothing spent.
 *   RUN    (--run, PAID)    Make the real calls through OpenRouter and report measured costs.
 *
 * Usage:
 *   node scripts/measure-chat-research.mjs
 *   OPENROUTER_API_KEY=... node scripts/measure-chat-research.mjs --run [--only=anthropic/claude-sonnet-5.5] [--search-model=mistralai/mistral-small-2603] [--questions=1] [--budget=2]
 *
 * --budget (USD, default 2) stops the run once measured spend passes it. Cost is read from OpenRouter's own
 * `usage.cost` on each response. Reads the key from the environment and never prints it; vendor error text is never
 * printed, only the status code.
 */
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export const URL_COMPLETIONS = 'https://openrouter.ai/api/v1/chat/completions';
export const MODELS = ['anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna'];
export const QUESTIONS = [
    'What changed in the most recent stable Node.js release, and what should a team running Node 20 know before upgrading?',
    'Compare the current pricing and free tiers of the three biggest managed Postgres providers for a small SaaS.',
    'What are the main arguments for and against a four-day work week, according to recent studies?',
];
// Search steps run with reasoning off: a reasoning model left at its default can spend the whole token cap thinking and
// return no text, which hands the write step empty notes and makes the run look far cheaper than it is (seen 2026-10-05,
// and Claude Sonnet 5.5 still did it on 2 of 4 searches at 'low').
export const LIMITS = { searches: 4, results: 3, planTokens: 300, searchTokens: 1000, searchEffort: 'none', writeTokens: 8192, writeEffort: 'high' };
export const MODELS_URL = 'https://openrouter.ai/api/v1/models';
// Ways to ask OpenRouter for no reasoning on a search step, tried in order until one is accepted. A model may refuse
// `effort: none` (a 400 on 2026-10-05) yet accept another form; the one that works is reported so production uses it.
export const SEARCH_REASONING = Object.freeze([{ effort: 'none' }, { enabled: false }, { effort: 'minimal' }, { effort: 'low' }, null]);

const PLAN_SYSTEM = `Write up to ${LIMITS.searches} distinct web search queries that would help research the user's question. Reply with one query per line, no numbering and no commentary.`;
const WRITE_SYSTEM = 'Answer the question using only the research notes provided. Cite sources as links. Be concise and say when notes disagree.';

/** Parse a plan reply into at most LIMITS.searches non-empty, trimmed queries. */
export function parseQueries(text) {
    return String(text || '').split('\n').map((l) => l.replace(/^[\s\-*\d.)]+/, '').trim()).filter(Boolean).slice(0, LIMITS.searches);
}

/** A rejected request, with OpenRouter's own short validation message (the prompts here are fixed and public, so it is safe to show). */
export class ProviderRejected extends Error {
    constructor(status, detail) { super(`OpenRouter answered ${status}${detail ? `: ${detail}` : ''}`); this.status = status; }
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
export const RETRY = { attempts: 4, baseMs: 2000 };

/** One request, retried with a growing wait when the upstream provider is briefly rate-limited or unavailable. A refused
 *  request (400), a bad key (401) or no credit (402) is not retried. A retried call that never answered is not billed. */
async function call(args, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
    let last;
    for (let attempt = 1; attempt <= RETRY.attempts; attempt += 1) {
        try { return await callOnce(args); }
        catch (err) {
            last = err;
            if (!(err instanceof ProviderRejected) || !RETRY_STATUSES.has(err.status) || attempt === RETRY.attempts) throw err;
            await sleep(RETRY.baseMs * 2 ** (attempt - 1));
        }
    }
    throw last;
}

async function callOnce({ fetchImpl, apiKey, body }) {
    const t0 = Date.now();
    const res = await fetchImpl(URL_COMPLETIONS, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: false, usage: { include: true }, provider: { data_collection: 'deny' } }),
    });
    if (!res.ok) {
        // Only the error's message field, trimmed: never the request, and a 401/402/429 has nothing of ours in it.
        let detail = '';
        try { detail = String((await res.json())?.error?.message || '').replace(/\s+/g, ' ').slice(0, 240); } catch { /* no body */ }
        throw new ProviderRejected(res.status, detail);
    }
    const json = await res.json();
    const u = json.usage || {};
    return {
        text: json.choices?.[0]?.message?.content || '', finish: json.choices?.[0]?.finish_reason || null,
        promptTokens: u.prompt_tokens ?? null, completionTokens: u.completion_tokens ?? null,
        cost: Number.isFinite(u.cost) ? u.cost : null, ms: Date.now() - t0,
    };
}

/**
 * One research run. Returns the steps and the totals; `cost` is null if OpenRouter did not report one.
 * @param {{fetchImpl?:typeof fetch, apiKey:string, model:string, question:string}} a
 */
export async function runOne({ fetchImpl = fetch, apiKey, model, question, reasoningHint, searchModel = model }) {
    const started = Date.now();
    const steps = [];
    const plan = await call({ fetchImpl, apiKey, body: { model: searchModel, max_tokens: LIMITS.planTokens, messages: [{ role: 'system', content: PLAN_SYSTEM }, { role: 'user', content: question }] } });
    steps.push({ step: 'plan', ...plan });
    const queries = parseQueries(plan.text);
    const notes = [];
    // The searches do not depend on each other, so they run together: the run's wall-clock is the plan, the slowest search,
    // then the write. The cost is the same as running them one after another.
    // The plan and the searches can run on a cheaper, non-reasoning model than the write (--search-model): reasoning models
    // spend the token cap thinking and return no text (seen on Claude Sonnet 5.5), and the page text is the same either way.
    const searchBody = (q, reasoning) => ({
        model: searchModel, max_tokens: LIMITS.searchTokens, plugins: [{ id: 'web', max_results: LIMITS.results }], ...(reasoning ? { reasoning } : {}),
        messages: [{ role: 'user', content: `Search the web and summarise what you find, with source links, for: ${q}` }],
    });
    // Find a reasoning setting the model accepts with the first search, then run every search with it.
    // With a hint (the setting an earlier run of this model found) there is nothing to discover: all searches start together.
    let working = reasoningHint === undefined ? null : reasoningHint; const tried = [];
    const hinted = reasoningHint !== undefined;
    let first = null;
    if (!hinted) {
        first = await (async () => {
            for (const variant of SEARCH_REASONING) {
                try { const r = await call({ fetchImpl, apiKey, body: searchBody(queries[0], variant) }); working = variant; return r; }
                catch (err) { tried.push({ variant, error: err.message }); if (!(err instanceof ProviderRejected) || err.status !== 400) throw err; }
            }
            throw new Error(`no reasoning setting was accepted for searches: ${tried.map((t) => `${JSON.stringify(t.variant)} -> ${t.error}`).join('; ')}`);
        })();
    }
    // Discovery used the first query; the rest (or all of them, with a hint) start together.
    const todo = hinted ? queries : queries.slice(1);
    const rest = await Promise.all(todo.map((q) => call({ fetchImpl, apiKey, body: searchBody(q, working) })));
    const searched = (hinted ? rest : [first, ...rest]).map((s, i) => ({ q: queries[i], s }));
    for (const { q, s } of searched) {
        steps.push({ step: 'search', query: q, ...s, chars: s.text.length });
        notes.push(`## ${q}\n${s.text}`);
    }
    // A run whose notes are empty is not a measurement of a research run: refuse to report it.
    if (queries.length === 0 || steps.filter((x) => x.step === 'search').every((x) => !x.text.trim())) {
        throw new Error('no search step returned any text, so the write step would have nothing to read; not a valid measurement');
    }
    const write = await call({ fetchImpl, apiKey, body: {
        model, max_tokens: LIMITS.writeTokens, reasoning: { effort: LIMITS.writeEffort },
        messages: [{ role: 'system', content: WRITE_SYSTEM }, { role: 'user', content: `Question: ${question}\n\nResearch notes:\n${notes.join('\n\n')}` }],
    } });
    steps.push({ step: 'write', ...write });
    const costs = steps.map((s) => s.cost);
    return { model, searchModel, question, steps, searches: queries.length, searchReasoning: working, cost: costs.every((c) => c !== null) ? costs.reduce((a, b) => a + b, 0) : null,
        ms: Date.now() - started, // wall-clock for the whole run, which is what the 120 s ceiling is measured against
        emptySearches: steps.filter((s) => s.step === 'search' && !s.text.trim()).length };
}

/** Per-token prices for the models, from OpenRouter's public list (no key). Empty if it cannot be read. */
export async function fetchRates(models, fetchImpl = fetch) {
    try {
        const res = await fetchImpl(MODELS_URL);
        if (!res.ok) return {};
        const data = (await res.json()).data || [];
        const out = {};
        for (const m of data) {
            const prompt = Number(m.pricing?.prompt), completion = Number(m.pricing?.completion);
            if (models.includes(m.id) && Number.isFinite(prompt) && Number.isFinite(completion)) out[m.id] = { prompt, completion };
        }
        return out;
    } catch { return {}; }
}

/**
 * The ADR's recorded worst case: the dearest plan + 4 x the dearest search + the dearest write. A write is bounded from
 * rates when we have them: the largest write input seen at the model's prompt price, plus a full reply cap at its
 * completion price (reasoning tokens bill as completion). One sample rarely reaches the cap, so the bound is used when it
 * is higher than anything measured.
 * @param {Array} runs @param {{prompt:number, completion:number}} [rate]
 */
export function worstCase(runs, rate) {
    const steps = (kind) => runs.flatMap((r) => r.steps.filter((s) => s.step === kind && s.cost !== null));
    const max = (kind) => Math.max(0, ...steps(kind).map((s) => s.cost));
    const measuredWrite = max('write');
    const maxWriteIn = Math.max(0, ...steps('write').map((s) => s.promptTokens ?? 0));
    const atCap = rate && maxWriteIn > 0 ? maxWriteIn * rate.prompt + LIMITS.writeTokens * rate.completion : null;
    const write = atCap !== null ? Math.max(measuredWrite, atCap) : measuredWrite;
    return { plan: max('plan'), search: max('search'), write, measuredWrite, writeBasis: atCap !== null && atCap > measuredWrite ? 'rates' : 'measured',
        total: max('plan') + LIMITS.searches * max('search') + write };
}

const usd = (n) => (n === null || n === undefined ? 'n/a' : `$${n.toFixed(4)}`);

export async function runProbe({ fetchImpl = fetch, apiKey, models = MODELS, questions = QUESTIONS, budget = 2, searchModel, log = console.log }) {
    const byModel = {}; const hints = {}; let spent = 0;
    for (const model of models) {
        byModel[model] = [];
        for (const question of questions) {
            if (spent > budget) { log(`  budget $${budget} passed: stopping`); return { byModel, spent, stopped: true }; }
            const run = await runOne({ fetchImpl, apiKey, model, question, reasoningHint: hints[model], searchModel });
            if (run.searchReasoning !== undefined) hints[model] = run.searchReasoning; // later questions skip discovery
            byModel[model].push(run);
            spent += run.cost ?? 0;
            log(`  write ${model}${searchModel && searchModel !== model ? ` / plan+search ${searchModel}` : ''}  ${run.searches} searches (${run.emptySearches} empty)  ${usd(run.cost)}  ${(run.ms / 1000).toFixed(0)}s wall  ${question.slice(0, 48)}...`);
            for (const s of run.steps) log(`      ${s.step.padEnd(6)} in ${s.promptTokens ?? '?'} out ${s.completionTokens ?? '?'}  ${usd(s.cost)}  ${(s.ms / 1000).toFixed(1)}s${s.finish === 'length' ? '  HIT TOKEN CAP' : ''}${s.step === 'search' && !s.chars ? '  EMPTY' : ''}`);
        }
    }
    return { byModel, spent, stopped: false };
}

// Compare real paths: on macOS /tmp is a link to /private/tmp, and a plain comparison silently skipped the whole run.
export const isMain = (argv1, metaUrl) => { try { return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; } };
if (isMain(process.argv[1], import.meta.url)) {
    const args = process.argv.slice(2);
    const run = args.includes('--run');
    const only = args.find((a) => a.startsWith('--only='))?.slice(7);
    const nQ = Number(args.find((a) => a.startsWith('--questions='))?.slice(12)) || QUESTIONS.length;
    const budget = Number(args.find((a) => a.startsWith('--budget='))?.slice(9)) || 2;
    const searchModel = args.find((a) => a.startsWith('--search-model='))?.slice(15);
    if (searchModel && !/^[a-z0-9][a-z0-9._:/-]{0,100}$/i.test(searchModel)) { console.error('bad --search-model'); process.exit(2); }
    const models = MODELS.filter((m) => !only || m === only);
    const questions = QUESTIONS.slice(0, Math.max(1, Math.min(nQ, QUESTIONS.length)));
    if (models.length === 0) { console.error(`no such model: ${only}`); process.exit(2); }
    console.log(run ? 'RUN: this spends OpenRouter credit.\n' : 'PLAN: nothing is sent or spent.\n');
    console.log(`write model(s): ${models.join(', ')}${searchModel ? `\nplan and search model: ${searchModel}` : ''}\nquestions: ${questions.length}\nper run: 1 plan (<= ${LIMITS.planTokens} tokens), <= ${LIMITS.searches} searches (web plugin, ${LIMITS.results} results, <= ${LIMITS.searchTokens} tokens), 1 write (<= ${LIMITS.writeTokens} tokens, effort ${LIMITS.writeEffort})\nbudget: $${budget}\n`);
    if (run) {
        const apiKey = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
        if (!apiKey) { console.error('Set OPENROUTER_API_KEY (or OPENROUTER_CHAT_API_KEY).'); process.exit(2); }
        const { byModel, spent } = await runProbe({ apiKey, models, questions, budget, searchModel });
        const rates = await fetchRates(models);
        console.log(`\nmeasured spend: ${usd(spent)}\n`);
        for (const [model, runs] of Object.entries(byModel)) {
            if (!runs.length) continue;
            const w = worstCase(runs, rates[model]);
            console.log(`${model}: dearest plan ${usd(w.plan)}, search ${usd(w.search)}, write ${usd(w.write)} (${w.writeBasis}; measured ${usd(w.measuredWrite)})`);
            console.log(`  recorded worst case (plan + ${LIMITS.searches} x search + write): ${usd(w.total)}  -> candidate chat_research_extra_cost`);
            console.log(`  slowest run: ${(Math.max(...runs.map((r) => r.ms)) / 1000).toFixed(0)}s wall (ADR ceiling 120s); empty searches: ${runs.reduce((a, r) => a + r.emptySearches, 0)}`);
            console.log(`  search reasoning setting accepted: ${JSON.stringify(runs[0].searchReasoning)}`);
            const slowestWrite = Math.max(...runs.flatMap((r) => r.steps.filter((x) => x.step === 'write').map((x) => x.ms)));
            console.log(`  slowest write: ${(slowestWrite / 1000).toFixed(0)}s for what it produced; a full ${LIMITS.writeTokens}-token reply is longer, so the ceiling needs headroom`);
        }
    }
}
