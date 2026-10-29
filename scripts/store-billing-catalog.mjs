#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const schema = new URL('../packages/db/schema/supabase/', import.meta.url);
const sql = name => readFileSync(new URL(name + '.sql', schema), 'utf8').replace(/--[^\n]*/g, '');
function section(source, pattern, label) {
    const match = source.match(pattern);
    if (!match) throw new Error(`Catalog SQL shape changed: ${label}`);
    return match[1];
}
function rows(source) {
    return [...source.matchAll(/\(([^()]*)\)/g)].map(match => match[1].split(',').map(value => {
        const token = value.trim();
        if (/^'[^']*'$/.test(token)) return token.slice(1, -1);
        if (/^\d+$/.test(token)) return Number(token);
        if (token === 'true' || token === 'false') return token === 'true';
        throw new Error('Unsupported catalog SQL value');
    }));
}
function insertedPlans(name, table) {
    const source = sql(name);
    const match = source.match(new RegExp(`INSERT INTO public\\.${table}\\s*\\(([^)]+)\\)\\s*VALUES\\s*([\\s\\S]*?)ON CONFLICT`));
    if (!match) throw new Error(`Catalog plan INSERT changed: ${name}`);
    const columns = match[1].split(',').map(x => x.trim());
    return rows(match[2]).map(values => {
        if (values.length !== columns.length) throw new Error(`Catalog plan columns changed: ${name}`);
        return { active: true, ...Object.fromEntries(columns.map((key, i) => [key, values[i]])) };
    });
}

// A deliberately bounded SQL reader for the catalog at migration 0394, not a SQL interpreter.
// Values come from INSERTs and the subsequent guarded UPDATEs, never duplicated price constants.
export function storeBillingCatalog() {
    const generation = new Map();
    for (const name of ['0186_credit_subscriptions', '0381_lite_plan_and_plan_credit_limits', '0383_yearly_credit_subscriptions']) {
        for (const plan of insertedPlans(name, 'credit_subscription_plans')) generation.set(plan.id, plan);
        for (const match of sql(name).matchAll(/UPDATE public\.credit_subscription_plans SET credits = (\d+), updated_at = now\(\)\s*WHERE id = '([^']+)'/g)) {
            const plan = generation.get(match[2]);
            if (!plan) throw new Error('Catalog credit UPDATE names an unknown plan');
            plan.credits = Number(match[1]);
        }
    }
    const activation = sql('0385_activate_yearly_plans');
    if (!/SET active = true/.test(activation)) throw new Error('Yearly activation SQL changed');
    for (const [id, price, credits] of rows(section(activation, /FROM \(VALUES([\s\S]*?)\) AS v\(id, price, credits\)/, 'yearly activation'))) {
        const plan = generation.get(id);
        if (!plan || plan.price_usd_cents !== price || plan.credits !== credits) throw new Error('Yearly activation no longer matches');
        plan.active = true;
    }
    const publish = new Map(['0293_social_publish_plans', '0340_weekly_social_publish_plan', '0341_annual_social_publish_plan']
        .flatMap(name => insertedPlans(name, 'social_publish_plans')).map(plan => [plan.id, plan]));
    const parity = sql('0394_mobile_credit_pack_parity');
    const packs = rows(section(parity, /FOR pack IN SELECT \* FROM \(VALUES([\s\S]*?)\) AS expected/, 'packs'));
    const catalog = packs.map(([, store, credits, price, productId]) => ({ store, productId,
        kind: 'consumable', credits, plan: null, period: null, priceUsdCents: price,
        offering: 'credits', package: String(credits) }));
    const addPlan = (store, productId, planId, offering) => {
        const plan = (offering === 'generation' ? generation : publish).get(planId);
        if (!plan) throw new Error(`Unknown mapped plan: ${planId}`);
        if (!plan.active) return;
        const suffix = productId.split(':')[0].split('.').slice(offering === 'generation' ? -2 : -1).join('-');
        catalog.push({ store, productId, kind: 'auto-renewable subscription', credits: plan.credits ?? null,
            plan: plan.id, period: plan.billing_interval, priceUsdCents: plan.price_usd_cents,
            offering, package: suffix });
    };
    for (const [product, plan] of rows(section(sql('0346_store_publish_subscriptions'), /FROM \(VALUES([\s\S]*?)\) AS m\(product, plan\)/, 'Publish mapping'))) {
        addPlan('ios', product, plan, 'publish');
    }
    const mapping = sql('0393_store_generation_subscriptions');
    for (const [family, storeInterval, planInterval] of rows(section(mapping, /FROM \(VALUES([\s\S]*?)\)\s*AS plans\(family, store_interval, plan_interval\)/, 'Generation mapping'))) {
        addPlan('ios', `ai.veyrnox.generation.${family}.${storeInterval}`, `${family}-${planInterval}`, 'generation');
    }
    // 0394's qualified Play identifiers are the saleable products. Unqualified historical
    // mappings remain valid for settlement, but are not additional products to create.
    for (const match of parity.matchAll(/FROM \(VALUES([^;]*?)\) AS mapping\(product_id, plan_id\)/g)) {
        for (const [product, plan] of rows(match[1])) addPlan('android', product, plan, product.includes('.generation.') ? 'generation' : 'publish');
    }
    if (catalog.length !== 28 || new Set(catalog.map(p => `${p.store}:${p.productId}`)).size !== 28) {
        throw new Error('Catalog mapping shape changed; review the SQL reader');
    }
    return catalog.sort((a, b) => a.store.localeCompare(b.store) || a.productId.localeCompare(b.productId));
}

export function catalogMarkdown(catalog = storeBillingCatalog()) {
    return ['| Store | Product ID | Kind | Credits / plan | Period | USD | Offering / package |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...catalog.map(p => `| ${p.store} | ${p.productId} | ${p.kind} | ${p.plan ?? p.credits}${p.plan && p.credits ? ` (${p.credits} credits/month)` : ''} | ${p.period ?? 'one-off'} | $${(p.priceUsdCents / 100).toFixed(2)} | ${p.offering} / ${p.package} |`)].join('\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    console.log(process.argv.includes('--json') ? JSON.stringify(storeBillingCatalog(), null, 2) : catalogMarkdown());
}
