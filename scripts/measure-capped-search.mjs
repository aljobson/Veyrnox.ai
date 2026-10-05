#!/usr/bin/env node
/**
 * Measure what the capped web search costs (ADR-0067 amendment 8), so the Web search price can be recorded from real numbers
 * before any row is flipped to the 'capped' engine. It makes a few real searches through the same adapter the chat uses, reads
 * the provider's own `costDollars.total` for each, and turns the dearest into a fee bound and a per-model Web search extra.
 * It writes nothing to the catalog.
 *
 *   PLAN   (default, free)  Print the queries, the limits and the formula. No network, nothing spent.
 *   RUN    (--run, PAID)    Make the real searches and print the measured costs and the resulting prices.
 *
 * Usage:
 *   node scripts/measure-capped-search.mjs
 *   EXA_API_KEY=... node scripts/measure-capped-search.mjs --run [--queries=5]
 *
 * Reads the key from the environment and never prints it; vendor text is never printed, only the typed error code.
 */
import { fileURLToPath } from 'node:url';
import { SEARCH_LIMITS, SearchError, searchWeb } from '../packages/adapters/exa.js';
import { SEARCH_CONTEXT_MAX_CHARS, searchApiKey } from '../lib/chat.js';

export const QUERIES = [
    'What changed in the most recent stable Node.js release?',
    'Compare the free tiers of the biggest managed Postgres providers for a small SaaS.',
    'Main arguments for and against a four-day work week, according to recent studies.',
    'How do I rotate a leaked API key safely?',
    'What is the current state of passkey adoption in consumer apps?',
    'Best practices for append-only ledgers in payment systems.',
];

// What the model is given from a search, in tokens: the context limit at 3.5 characters a token, rounded up to a hundred.
export const TOKENS_BOUND = Math.ceil(SEARCH_CONTEXT_MAX_CHARS / 3.5 / 100) * 100;
// The margin floor (docs/pricing/50-percent-margin.md): credits >= ceil(cost / FLOOR).
const FLOOR = 0.01796;
// Input rate in USD per token for each chat row, from OpenRouter's public model list on 2026-10-05. The same figures 0210 used.
export const INPUT_RATES = {
    'chat-claude-opus-5.5': 4e-6, 'chat-claude-sonnet-5.5': 2e-6, 'chat-gpt-6.1-sol': 2e-6, 'chat-grok-4.7': 2e-6,
    'chat-gemini-3.8-flash': 7.5e-7, 'chat-deepseek-v4.1-flash': 3e-7, 'chat-gpt-6-luna': 1e-7,
    'chat-llama-4-maverick': 1.875e-7, 'chat-ministral-14b': 2e-7, 'chat-mistral-small': 1.5e-7,
};

const up = (n, step) => Math.round(Math.ceil(Math.round((n / step) * 1e6) / 1e6) * step * 1e6) / 1e6;

/** The dearest measured search plus 50%, rounded up to a tenth of a cent, and never below a cent. */
export function feeBound(costs) {
    const seen = costs.filter((c) => Number.isFinite(c));
    if (!seen.length) throw new Error('no measured costs: nothing to bound');
    return Math.max(0.01, up(Math.max(...seen) * 1.5, 0.001));
}

/** Each row's Web search extra for a fee bound: fee + TOKENS_BOUND input tokens at the row's rate, and the Credits that clear the floor. */
export function extraCosts(fee) {
    return Object.entries(INPUT_RATES).map(([id, rate]) => {
        const cost = up(fee + TOKENS_BOUND * rate, 0.0001);
        return { id, cost, credits: Math.max(1, Math.ceil(Math.round((cost / FLOOR) * 1e6) / 1e6)) };
    }).sort((a, b) => a.id.localeCompare(b.id));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const run = args.includes('--run');
    const n = Math.max(1, Math.min(Number(args.find((a) => a.startsWith('--queries='))?.slice(10)) || 5, QUERIES.length));
    console.log(run ? 'RUN: this spends search credit.\n' : 'PLAN: nothing is sent or spent.\n');
    console.log(`queries: ${n}\nper search: ${SEARCH_LIMITS.results} results, <= ${SEARCH_LIMITS.charsPerResult} characters each, query <= ${SEARCH_LIMITS.queryChars} characters`);
    console.log(`model reads <= ${SEARCH_CONTEXT_MAX_CHARS} characters (${TOKENS_BOUND} tokens)\nformula: extra cost = fee bound + ${TOKENS_BOUND} x the model's input rate; credits = ceil(cost / ${FLOOR})\n`);
    if (run) {
        const apiKey = searchApiKey(process.env);
        if (!apiKey) { console.error('Set EXA_API_KEY.'); process.exit(2); }
        const costs = [];
        for (const q of QUERIES.slice(0, n)) {
            try {
                const r = await searchWeb({ apiKey, query: q });
                const chars = r.results.reduce((a, x) => a + x.text.length, 0);
                costs.push(r.costUsd);
                console.log(`  ${r.results.length} results  ${chars} chars  cost ${r.costUsd === null ? 'n/a' : `$${r.costUsd.toFixed(4)}`}  ${q.slice(0, 50)}`);
            } catch (e) {
                console.log(`  failed: ${e instanceof SearchError ? e.code : 'unexpected error'}  ${q.slice(0, 50)}`);
            }
        }
        const fee = feeBound(costs);
        console.log(`\nfee bound: $${fee.toFixed(4)} (dearest search x 1.5, rounded up)\n`);
        for (const r of extraCosts(fee)) console.log(`  ${r.id.padEnd(26)} cost $${r.cost.toFixed(4)}  -> ${r.credits} Credit${r.credits === 1 ? '' : 's'}`);
        console.log('\nThese are candidates for the flip migration. Nothing was written.');
    }
}
