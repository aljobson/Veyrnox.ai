import * as stripe from '../packages/adapters/stripe.js';
import { createPublishPlanCheckout } from '../packages/adapters/stripePublishPlan.js';
import { createCreditSubscriptionCheckout, creditStripeRequest } from '../packages/adapters/stripeCreditSubscriptions.js';
import { refundFlaggedPass } from '../lib/cinema/operatorRefund.js';
const id = '11111111-1111-4111-8111-111111111111';
const input = { topUpId: id, passId: id, subscriptionId: id, planId: 'starter', interval: 'month', priceUsdCents: 1500, credits: 200, email: 'ü+ a@example.test', expiresAt: 2000000000 };
const session = { object: 'checkout.session', id: 'cs_fixture', url: 'https://checkout.stripe.com/c/pay/test' };
const cfg = { apiKey: 'sk_test_fixture', publicHost: 'https://veyrnox.test', signingSecret: 'fixture_secret', idempotencyKey: 'idempotency_fixture' };
const operation = { action_id: id, subscription_id: 'sub_1', customer_id: 'cus_1' };
const refund = { object: 'refund', id: 're_1', amount: 1299, currency: 'usd', payment_intent: 'pi_1', charge: 'ch_1', metadata: { cinema_operator_action_id: id }, status: 'succeeded' };
const replies = {
    '/v1/subscriptions/sub_1': { object: 'subscription', id: 'sub_1', customer: 'cus_1', livemode: false, status: 'canceled', latest_invoice: 'in_1' },
    '/v1/invoices/in_1': { object: 'invoice', id: 'in_1', customer: 'cus_1', livemode: false, subscription: 'sub_1', status: 'paid', currency: 'usd', billing_reason: 'subscription_create', payment_intent: 'pi_1', amount_paid: 1299 },
    '/v1/payment_intents/pi_1': { object: 'payment_intent', id: 'pi_1', customer: 'cus_1', currency: 'usd', livemode: false, status: 'succeeded', amount_received: 1299, latest_charge: { object: 'charge', id: 'ch_1', customer: 'cus_1', currency: 'usd', livemode: false, payment_intent: 'pi_1', paid: true, captured: true, disputed: false, amount: 1299, amount_refunded: 0 } },
};
export async function requestCases() {
    const results = {};
    const cases = {
        pack: c => stripe.createCheckout(input, c),
        pass: c => stripe.createPassCheckout(input, c),
        publish: c => createPublishPlanCheckout(input, c),
        credit: c => createCreditSubscriptionCheckout(input, c),
        packNull: c => stripe.createCheckout({ ...input, email: null, expiresAt: null }, c),
        publishNull: c => createPublishPlanCheckout({ ...input, email: null, expiresAt: null }, c),
        creditNull: c => createCreditSubscriptionCheckout({ ...input, email: null, expiresAt: null }, c),
        creditFields: c => creditStripeRequest('example', c, { a: null, b: undefined, c: '', d: false, 'x[y]': ' +ü' }, ''),
        creditGet: c => creditStripeRequest('invoices/in_1?expand[]=payments', c),
        refund: c => stripe.createRefund({ paymentIntentId: 'pi_1', amountCents: 1299 }, c, 'refund:key'),
        get: c => stripe.fetchSubscription('sub_1', c),
        session: c => stripe.fetchSession('cs_fixture', c),
        cancel: c => stripe.cancelSubscriptionNow('sub_1', c),
        operator: c => refundFlaggedPass(operation, c),
    };
    for (const [name, run] of Object.entries(cases)) for (const mode of ['success', 'http', 'json', 'transport']) {
        const calls = [];
        const result = await run({ ...cfg, fetch: async (url, init) => {
            const { signal, ...request } = init;
            calls.push({ url, ...request, hasSignal: signal instanceof AbortSignal });
            if (mode === 'transport') throw new Error('fixture transport');
            if (mode === 'json') return new Response('invalid json');
            if (mode === 'http') return Response.json({ error: { code: 'fixture' } }, { status: 429 });
            const path = new URL(url).pathname;
            return Response.json(path === '/v1/refunds' ? (init.method === 'POST' ? refund : { object: 'list', has_more: false, data: [] }) : replies[path] || session);
        } });
        results[`${name}/${mode}`] = { calls, result };
    }
    return results;
}
