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
 *   OPENROUTER_API_KEY=... node scripts/measure-chat-research.mjs --run [--only=openai/gpt-6-luna] [--questions=1] [--budget=2]
 *
 * --budget (USD, default 2) stops the run once measured spend passes it. Cost is read from OpenRouter's own
 * `usage.cost` on each response. Reads the key from the environment and never prints it; vendor error text is never
 * printed, only the status code.
 */
import { fileURLToPath } from 'node:url';

export const URL_COMPLETIONS = 'https://openrouter.ai/api/v1/chat/completions';
export const MODELS = ['anthropic/claude-sonnet-5.5', 'openai/gpt-6-luna'];
export const QUESTIONS = [
    'What changed in the most recent stable Node.js release, and what should a team running Node 20 know before upgrading?',
    'Compare the current pricing and free tiers of the three biggest managed Postgres providers for a small SaaS.',
    'What are the main arguments for and against a four-day work week, according to recent studies?',
];
export const LIMITS = { searches: 4, results: 3, planTokens: 300, searchTokens: 700, writeTokens: 8192, writeEffort: 'high' };

const PLAN_SYSTEM = `Write up to ${LIMITS.searches} distinct web search queries that would help research the user's question. Reply with one query per line, no numbering and no commentary.`;
const WRITE_SYSTEM = 'Answer the question using only the research notes provided. Cite sources as links. Be concise and say when notes disagree.';

/** Parse a plan reply into at most LIMITS.searches non-empty, trimmed queries. */
export function parseQueries(text) {
    return String(text || '').split('\n').map((l) => l.replace(/^[\s\-*\d.)]+/, '').trim()).filter(Boolean).slice(0, LIMITS.searches);
}

async function call({ fetchImpl, apiKey, body }) {
    const t0 = Date.now();
    const res = await fetchImpl(URL_COMPLETIONS, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: false, usage: { include: true }, provider: { data_collection: 'deny' } }),
    });
    if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`); // never the body: it can echo the prompt
    const json = await res.json();
    const u = json.usage || {};
    return {
        text: json.choices?.[0]?.message?.content || '',
        promptTokens: u.prompt_tokens ?? null, completionTokens: u.completion_tokens ?? null,
        cost: Number.isFinite(u.cost) ? u.cost : null, ms: Date.now() - t0,
    };
}

/**
 * One research run. Returns the steps and the totals; `cost` is null if OpenRouter did not report one.
 * @param {{fetchImpl?:typeof fetch, apiKey:string, model:string, question:string}} a
 */
export async function runOne({ fetchImpl = fetch, apiKey, model, question }) {
    const steps = [];
    const plan = await call({ fetchImpl, apiKey, body: { model, max_tokens: LIMITS.planTokens, messages: [{ role: 'system', content: PLAN_SYSTEM }, { role: 'user', content: question }] } });
    steps.push({ step: 'plan', ...plan });
    const queries = parseQueries(plan.text);
    const notes = [];
    for (const q of queries) {
        const s = await call({ fetchImpl, apiKey, body: {
            model, max_tokens: LIMITS.searchTokens, plugins: [{ id: 'web', max_results: LIMITS.results }],
            messages: [{ role: 'user', content: `Search the web and summarise what you find, with source links, for: ${q}` }],
        } });
        steps.push({ step: 'search', query: q, ...s });
        notes.push(`## ${q}\n${s.text}`);
    }
    const write = await call({ fetchImpl, apiKey, body: {
        model, max_tokens: LIMITS.writeTokens, reasoning: { effort: LIMITS.writeEffort },
        messages: [{ role: 'system', content: WRITE_SYSTEM }, { role: 'user', content: `Question: ${question}\n\nResearch notes:\n${notes.join('\n\n')}` }],
    } });
    steps.push({ step: 'write', ...write });
    const costs = steps.map((s) => s.cost);
    return { model, question, steps, searches: queries.length, cost: costs.every((c) => c !== null) ? costs.reduce((a, b) => a + b, 0) : null,
        ms: steps.reduce((a, s) => a + s.ms, 0) };
}

/** The ADR's recorded worst case from measured steps: the dearest plan + 4 x the dearest search + the dearest write. */
export function worstCase(runs) {
    const max = (kind) => Math.max(0, ...runs.flatMap((r) => r.steps.filter((s) => s.step === kind && s.cost !== null).map((s) => s.cost)));
    return { plan: max('plan'), search: max('search'), write: max('write'), total: max('plan') + LIMITS.searches * max('search') + max('write') };
}

const usd = (n) => (n === null || n === undefined ? 'n/a' : `$${n.toFixed(4)}`);

export async function runProbe({ fetchImpl = fetch, apiKey, models = MODELS, questions = QUESTIONS, budget = 2, log = console.log }) {
    const byModel = {}; let spent = 0;
    for (const model of models) {
        byModel[model] = [];
        for (const question of questions) {
            if (spent > budget) { log(`  budget $${budget} passed: stopping`); return { byModel, spent, stopped: true }; }
            const run = await runOne({ fetchImpl, apiKey, model, question });
            byModel[model].push(run);
            spent += run.cost ?? 0;
            log(`  ${model}  ${run.searches} searches  ${usd(run.cost)}  ${(run.ms / 1000).toFixed(0)}s  ${question.slice(0, 48)}...`);
            for (const s of run.steps) log(`      ${s.step.padEnd(6)} in ${s.promptTokens ?? '?'} out ${s.completionTokens ?? '?'}  ${usd(s.cost)}  ${(s.ms / 1000).toFixed(1)}s`);
        }
    }
    return { byModel, spent, stopped: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const run = args.includes('--run');
    const only = args.find((a) => a.startsWith('--only='))?.slice(7);
    const nQ = Number(args.find((a) => a.startsWith('--questions='))?.slice(12)) || QUESTIONS.length;
    const budget = Number(args.find((a) => a.startsWith('--budget='))?.slice(9)) || 2;
    const models = MODELS.filter((m) => !only || m === only);
    const questions = QUESTIONS.slice(0, Math.max(1, Math.min(nQ, QUESTIONS.length)));
    if (models.length === 0) { console.error(`no such model: ${only}`); process.exit(2); }
    console.log(run ? 'RUN: this spends OpenRouter credit.\n' : 'PLAN: nothing is sent or spent.\n');
    console.log(`models: ${models.join(', ')}\nquestions: ${questions.length}\nper run: 1 plan (<= ${LIMITS.planTokens} tokens), <= ${LIMITS.searches} searches (web plugin, ${LIMITS.results} results, <= ${LIMITS.searchTokens} tokens), 1 write (<= ${LIMITS.writeTokens} tokens, effort ${LIMITS.writeEffort})\nbudget: $${budget}\n`);
    if (run) {
        const apiKey = process.env.OPENROUTER_CHAT_API_KEY || process.env.OPENROUTER_API_KEY;
        if (!apiKey) { console.error('Set OPENROUTER_API_KEY (or OPENROUTER_CHAT_API_KEY).'); process.exit(2); }
        const { byModel, spent } = await runProbe({ apiKey, models, questions, budget });
        console.log(`\nmeasured spend: ${usd(spent)}\n`);
        for (const [model, runs] of Object.entries(byModel)) {
            if (!runs.length) continue;
            const w = worstCase(runs);
            console.log(`${model}: dearest plan ${usd(w.plan)}, search ${usd(w.search)}, write ${usd(w.write)}`);
            console.log(`  recorded worst case (plan + ${LIMITS.searches} x search + write): ${usd(w.total)}  -> candidate chat_research_extra_cost`);
            console.log(`  slowest run: ${(Math.max(...runs.map((r) => r.ms)) / 1000).toFixed(0)}s (ADR ceiling 120s)`);
        }
    }
}
