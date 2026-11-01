#!/usr/bin/env node
/**
 * Asks AI answer engines the questions in scripts/aeo/questions.json and
 * records whether veyrnox.ai is named or linked, and who is linked instead.
 * PAID: each question is one search-enabled call per engine, roughly
 * $0.01-0.05 each, so the full list on all three engines is about $1-3.
 * Without --run it only prints the plan and spends nothing.
 *
 *   read -s "PERPLEXITY_API_KEY?Perplexity key: "; export PERPLEXITY_API_KEY
 *   read -s "OPENAI_API_KEY?OpenAI key: ";         export OPENAI_API_KEY
 *   read -s "ANTHROPIC_API_KEY?Anthropic key: ";   export ANTHROPIC_API_KEY
 *   node scripts/probe-aeo-citations.mjs                    # plan, spends nothing
 *   node scripts/probe-aeo-citations.mjs --run --limit 2    # first two questions
 *   node scripts/probe-aeo-citations.mjs --run              # all questions
 *   node scripts/probe-aeo-citations.mjs --run --engines perplexity,openai
 *   unset PERPLEXITY_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY
 *
 * Keys come from the environment only and are never printed. An engine
 * without a key is skipped. Models can be changed with OPENAI_MODEL,
 * ANTHROPIC_MODEL and PERPLEXITY_MODEL. The three request shapes follow each
 * vendor's search-tool docs but have not been run against the live services:
 * start with --limit 2 and read the first answer file before a full run.
 *
 * Results go to .gstack/aeo/<date>.json (gitignored: the repo is public and a
 * citation report is a finding, not source). It touches nothing of Veyrnox's.
 */
import { readFileSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { EXTRACTORS, score, summarise } from './lib/aeo-citations.mjs';

const ENGINES = {
    perplexity: {
        key: 'PERPLEXITY_API_KEY',
        request: (q) => ({
            url: 'https://api.perplexity.ai/chat/completions',
            headers: {},
            body: { model: process.env.PERPLEXITY_MODEL || 'sonar', messages: [{ role: 'user', content: q }] },
        }),
        auth: (key) => ({ Authorization: `Bearer ${key}` }),
    },
    openai: {
        key: 'OPENAI_API_KEY',
        request: (q) => ({
            url: 'https://api.openai.com/v1/responses',
            headers: {},
            body: { model: process.env.OPENAI_MODEL || 'gpt-4.1', tools: [{ type: 'web_search_preview' }], input: q },
        }),
        auth: (key) => ({ Authorization: `Bearer ${key}` }),
    },
    anthropic: {
        key: 'ANTHROPIC_API_KEY',
        request: (q) => ({
            url: 'https://api.anthropic.com/v1/messages',
            headers: { 'anthropic-version': '2023-06-01' },
            body: {
                model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
                max_tokens: 1024,
                tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
                messages: [{ role: 'user', content: q }],
            },
        }),
        auth: (key) => ({ 'x-api-key': key }),
    },
};

function args(argv) {
    const out = { run: false, limit: Infinity, engines: Object.keys(ENGINES) };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--run') out.run = true;
        else if (argv[i] === '--limit') out.limit = Number(argv[++i]);
        else if (argv[i] === '--engines') out.engines = String(argv[++i]).split(',').filter(Boolean);
        else throw new Error(`unknown argument ${argv[i]}`);
    }
    if (!(out.limit >= 1)) throw new Error('--limit needs a number of 1 or more');
    const bad = out.engines.filter((e) => !ENGINES[e]);
    if (bad.length) throw new Error(`unknown engine ${bad.join(', ')}`);
    return out;
}

async function ask(name, question) {
    const engine = ENGINES[name];
    const req = engine.request(question);
    const res = await fetch(req.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...req.headers, ...engine.auth(process.env[engine.key]) },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return EXTRACTORS[name](await res.json());
}

export async function main(argv = process.argv.slice(2)) {
    const opts = args(argv);
    const questions = JSON.parse(readFileSync(new URL('./aeo/questions.json', import.meta.url), 'utf8')).slice(0, opts.limit);
    const active = opts.engines.filter((e) => process.env[ENGINES[e].key]);
    const skipped = opts.engines.filter((e) => !active.includes(e));
    console.log(`${questions.length} questions x ${active.length} engines = ${questions.length * active.length} paid calls (about $${(questions.length * active.length * 0.01).toFixed(2)}-$${(questions.length * active.length * 0.05).toFixed(2)})`);
    if (skipped.length) console.log(`no key, skipped: ${skipped.map((e) => `${e} (${ENGINES[e].key})`).join(', ')}`);
    if (!opts.run) { console.log('Plan only. Add --run to spend.'); return; }
    if (!active.length) throw new Error('no engine has a key set');

    const rows = [];
    for (const q of questions) {
        for (const engine of active) {
            try {
                const answer = await ask(engine, q.q);
                rows.push({ engine, id: q.id, kind: q.kind, question: q.q, text: answer.text, urls: answer.urls, score: score(answer) });
                console.log(`${engine.padEnd(10)} ${q.id.padEnd(22)} mentioned=${rows.at(-1).score.mentioned} cited=${rows.at(-1).score.cited} links=${answer.urls.length}`);
            } catch (err) {
                rows.push({ engine, id: q.id, kind: q.kind, question: q.q, error: String(err.message || err) });
                console.log(`${engine.padEnd(10)} ${q.id.padEnd(22)} FAILED ${err.message}`);
            }
        }
    }
    const summary = summarise(rows);
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync('.gstack/aeo', { recursive: true });
    const file = `.gstack/aeo/${date}.json`;
    writeFileSync(file, JSON.stringify({ date, summary, rows }, null, 2));
    console.log('\nSummary (answers / named / linked):');
    for (const [engine, kinds] of Object.entries(summary)) {
        for (const [kind, b] of Object.entries(kinds)) console.log(`  ${engine} ${kind}: ${b.answers} / ${b.mentioned} / ${b.cited}; others: ${b.topHosts.map(([h, n]) => `${h}(${n})`).join(' ')}`);
    }
    console.log(`\nSaved ${file}`);
}

// Run only when executed directly (a symlinked path would otherwise skip main).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    main().catch((err) => { console.error(String(err.message || err)); process.exit(1); });
}
