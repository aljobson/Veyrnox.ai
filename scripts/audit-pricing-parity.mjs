#!/usr/bin/env node
// Read-only scenario calculator. No database writes, network or credentials.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function evaluateMatch(model, match, plan, fees = { percent: 0, fixedUsd: 0 }) {
    const cost = Number(model.provider_cost_per_unit);
    for (const [name, value] of Object.entries({ cost, credits: match.credits, price: plan.price_usd,
        allowance: plan.credits, percent: fees.percent, fixed: fees.fixedUsd })) {
        if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`);
    }
    if (match.credits <= 0 || plan.credits <= 0 || plan.price_usd <= 0 || fees.percent >= 100) {
        throw new Error('Positive prices/credits and fee percent below 100 required');
    }
    // Historical cost_unit='per_second' rows store ONE priced clip's cost,
    // not cost per second. billing_seconds describes that clip; never multiply
    // cost by it. Match.unit must compare the same output duration/tier.
    const revenue = match.credits * plan.price_usd / plan.credits;
    const netPerCredit = (plan.price_usd * (1 - fees.percent / 100) - fees.fixedUsd) / plan.credits;
    const contribution = match.credits * netPerCredit - cost;
    return { revenue, cost, contribution, margin: contribution / revenue,
        providerBreakEven: contribution >= -1e-10,
        active: model.active, confidence: match.confidence };
}

export function report(snapshot, benchmark, fees) {
    const plans = benchmark.plans.filter(p => p.id.startsWith('ultra-'));
    const lines = [
        '# Veyrnox / Higgsfield parity audit — 24 September 2026', '',
        'Exact-parity counterfactual, superseded for rollout by the 50% margin requirement in 50-percent-margin.md. No production prices changed. Costs are recorded catalog costs, not a fresh provider invoice audit.', '',
        `[Higgsfield source](${benchmark.source}). Full tier assumptions are in higgsfield-2026-09-24.json.`, '',
        `Fee scenario: ${fees.percent}% of pre-tax pack price + $${fees.fixedUsd} per purchase. This is an assumption, not the verified Stripe account fee. Tax-base differences, FX, storage, retries, support and refunds are excluded.`, '',
        'Annual scenarios assume a full annual purchase and all monthly credits used. One-off packs at these rates would be a different commercial offer.', '',
        '| Model / unit | Active | Current → target credits | Cost | Monthly Ultra revenue | Monthly contribution | Annual Ultra contribution | Qualification |',
        '|---|---|---:|---:|---:|---:|---:|---|',
    ];
    for (const match of benchmark.matches) {
        const model = snapshot.models.find(m => m.id === match.id);
        if (!model) throw new Error(`Missing model: ${match.id}`);
        const [monthly, annual] = plans.map(p => evaluateMatch(model, match, p, fees));
        const money = n => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(4)}`;
        lines.push(`| ${match.unit} (${model.provider}) | ${model.active ? 'yes' : 'NO'} | ${model.credits_5s} → ${match.credits} | ${money(monthly.cost)} | ${money(monthly.revenue)} | ${money(monthly.contribution)} | ${money(annual.contribution)} | ${match.confidence} |`);
    }
    lines.push('', '## Models without a verified comparator', '');
    const matched = new Set(benchmark.matches.map(m => m.id));
    for (const m of snapshot.models.filter(m => m.active && !matched.has(m.id))) {
        lines.push(`- ${m.name}: ${m.credits_5s} credits, recorded cost $${Number(m.provider_cost_per_unit).toFixed(4)} ${m.cost_unit === 'per_second' && !m.billing_seconds ? 'per second' : 'per priced unit'}. Keep existing charge pending a matching tier.`);
    }
    lines.push('', '## Proposed monthly-price equivalent packs', '',
        '| Pack | Price, excluding tax | Credits |', '|---|---:|---:|');
    for (const p of benchmark.plans.filter(p => p.id.endsWith('-monthly'))) {
        lines.push(`| ${p.id} equivalent, one-off | $${p.price_usd} | ${p.credits} |`);
    }
    lines.push('', 'Keep paid credits non-expiring. These are proposed one-off equivalents, not implemented subscriptions. Annual billing, free-generation pools and unlimited promotions are outside this proposal.', '');
    return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const allowed = new Set(['--fee-percent', '--fixed-fee-usd']);
    const args = process.argv.slice(2);
    if (args.length % 2 || args.some((a, i) => i % 2 === 0 && !allowed.has(a))) {
        throw new Error('Usage: node scripts/audit-pricing-parity.mjs [--fee-percent N --fixed-fee-usd N]');
    }
    const opts = Object.fromEntries(Array.from({length: args.length / 2}, (_, i) => [args[i * 2], Number(args[i * 2 + 1])]));
    const read = name => JSON.parse(readFileSync(new URL(`../docs/pricing/${name}`, import.meta.url), 'utf8'));
    process.stdout.write(report(read('live-catalog-2026-09-24.json'), read('higgsfield-2026-09-24.json'), {
        percent: opts['--fee-percent'] ?? 0, fixedUsd: opts['--fixed-fee-usd'] ?? 0,
    }));
}
