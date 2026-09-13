#!/usr/bin/env node
/**
 * Price a web Credit Pack from its Stripe Price (ADR-0018 decision 4, ADR-0019).
 *
 *   node scripts/set-credit-pack-price.mjs <pack_id> <price_id> [--activate]
 *
 * Reads the amount from Stripe rather than from the operator, checks the Price
 * is sellable as a Top-up (one-time, USD, tax-exclusive, active, product tax
 * code txcd_10105001), then records stripe_price_id, price_cents and currency
 * on the pack. --activate also turns the pack on. The pricing-floor trigger
 * (0040) refuses a price under either floor; its message is printed as is.
 *
 * Env (operator machine only, never committed):
 *   STRIPE_SECRET_KEY          a key that can read Prices and Products
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Stripe Price amounts cannot be edited, so a price checked here stays true.
 * To change a pack's price, create a new Stripe Price and run this again.
 */
import { fileURLToPath } from 'node:url';
import { retrievePrice } from '../packages/adapters/stripe.js';

const PACK_ID_RE = /^[a-z0-9_]{1,32}$/;
const PRICE_ID_RE = /^price_[A-Za-z0-9]{1,64}$/;
const TAX_CODE = 'txcd_10105001';
const SALES_CHANNEL = 'web';

/** Reasons a Stripe Price cannot price a web Credit Pack; empty when it can. */
export function priceProblems(price) {
    const problems = [];
    if (!price || price.object !== 'price') return ['not a Stripe Price'];
    if (price.active !== true) problems.push('price is archived');
    if (price.type !== 'one_time') problems.push(`price type is ${price.type}, not one_time`);
    if (price.currency !== 'usd') problems.push(`currency is ${price.currency}, not usd`);
    if (!Number.isSafeInteger(price.unit_amount) || price.unit_amount <= 0) problems.push('unit_amount is not a positive integer');
    if (price.tax_behavior !== 'exclusive') problems.push(`tax_behavior is ${price.tax_behavior}, not exclusive`);
    const taxCode = price.product && typeof price.product === 'object' ? price.product.tax_code : undefined;
    if (taxCode !== TAX_CODE) problems.push(`product tax_code is ${taxCode}, not ${TAX_CODE}`);
    return problems;
}

async function main(argv) {
    const [packId, priceId, ...flags] = argv;
    const activate = flags.includes('--activate');
    if (!PACK_ID_RE.test(packId || '') || !PRICE_ID_RE.test(priceId || '') || flags.some((f) => f !== '--activate')) {
        console.error('usage: node scripts/set-credit-pack-price.mjs <pack_id> <price_id> [--activate]');
        return 2;
    }
    const { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error('STRIPE_SECRET_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
        return 2;
    }

    const got = await retrievePrice(priceId, { secretKey: STRIPE_SECRET_KEY });
    if (!got.ok) {
        console.error(`could not read ${priceId}: ${got.error}`);
        return 1;
    }
    const problems = priceProblems(got.price);
    if (problems.length) {
        console.error(`${priceId} cannot price a Credit Pack:\n  - ${problems.join('\n  - ')}`);
        return 1;
    }

    const url = new URL('/rest/v1/credit_packs', SUPABASE_URL);
    url.searchParams.set('id', `eq.${packId}`);
    url.searchParams.set('sales_channel', `eq.${SALES_CHANNEL}`);
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        },
        body: JSON.stringify({
            stripe_price_id: priceId,
            price_cents: got.price.unit_amount,
            currency: got.price.currency,
            ...(activate ? { active: true } : {}),
            updated_at: new Date().toISOString(),
        }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
        // PostgREST relays the trigger's message, e.g. which floor failed.
        console.error(`refused (${res.status}): ${(body && body.message) || 'unknown error'}`);
        return 1;
    }
    if (!Array.isArray(body) || body.length !== 1) {
        console.error(`no ${SALES_CHANNEL} pack with id ${packId}`);
        return 1;
    }
    const p = body[0];
    console.log(`${p.id}: ${p.credits} credits at ${p.price_cents} ${p.currency} cents (${priceId}, ${got.price.livemode ? 'live' : 'test'} mode), active=${p.active}`);
    return 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) process.exit(await main(process.argv.slice(2)));
