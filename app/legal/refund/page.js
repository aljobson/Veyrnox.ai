import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = {
    title: 'Refund Policy',
    description:
        'Exactly when credits come back to your balance: automatic refunds on failed generations, and what happens to purchased credits.',
    alternates: { canonical: '/legal/refund' },
};

export default function Refund() {
    return (
        <LegalPage title="Refund Policy" updated="16 October 2026">
            <p>This page explains refunds for generations, Credit Packs, Credit Subscriptions, the Veyrnox Publish Plan and Cinema Pass.</p>

            <h2>Failed generations — automatic</h2>
            <p>Every generation shows its credit cost before you confirm. Credits are debited on submission. If the model provider rejects the job or fails to return a result, the full debit is refunded to your balance automatically, usually within seconds. You do not need to contact us. The refund appears as a separate entry in your ledger.</p>

            <h2>Completed generations</h2>
            <p>Once a generation completes and the output is delivered, the credits are spent. We cannot refund completed generations because the underlying model provider has already charged us for the compute.</p>

            <h2>Free credits</h2>
            <p>The 10 credits granted on sign-up have no cash value, are not refundable in money, and expire 90 days after they are granted if unused. Purchased credits never expire.</p>

            <h2>Purchased credits</h2>
            <ul>
                <li>You can request a full refund of a credit pack within 14 days of purchase, as long as you have not generated anything since that purchase. Once you generate after buying, that purchase can no longer be refunded. Refunds go back to the original payment method, and the credits from that pack are removed from your balance.</li>
                <li>If you are a UK or EU consumer, this does not limit your statutory cancellation rights.</li>
                <li>If you joined through someone&rsquo;s referral link, refunding your first credit pack also reverses the referral reward that purchase earned for them. It does not change your refund.</li>
            </ul>

            <h2>Credit Subscriptions</h2>
            <ul>
                <li>You can stop renewal at any time from <a href="/app/credits#credit-subscriptions">Credits &amp; billing</a>. Your current Subscription Credits remain available only until the paid cycle ends; they do not roll over.</li>
                <li>Within 14 days of the initial subscription payment, you can request immediate cancellation and a full refund if none of that cycle&rsquo;s Subscription Credits has been used. The cycle&rsquo;s Credits are removed before the refund is sent to the original payment method.</li>
                <li>If any Subscription Credits have been used, or the initial 14-day period has ended, the immediate refund option is unavailable. You can still stop the next renewal.</li>
                <li>A pending or refused refund is not described as complete. The billing screen lets you retry a recoverable request or contact support when operator review is required.</li>
            </ul>

            <h2>Veyrnox Publish Plan</h2>
            <ul>
                <li>You can stop weekly, monthly or annual renewal from the Publish Plan page or its Stripe billing portal. The Plan continues until the current paid period ends.</li>
                <li>For a refund request, contact support with your account email and the payment reference. Your statutory rights are not affected.</li>
            </ul>

            <h2>Cinema Pass</h2>
            <ul>
                <li>You can cancel from the Cinema Pass page or its Stripe billing portal. After the initial cooling-off period, cancellation stops renewal and the Pass continues until the current paid period ends.</li>
                <li>If you cancel within 14 days of the first charge, the Pass ends immediately and we refund the unused share of that paid period to the original payment method.</li>
                <li>A refund of a Pass invoice ends that Pass. A payment dispute also ends the Pass and may pause the account while the dispute is reviewed.</li>
            </ul>

            <h2>How to cancel</h2>
            <p>Use the self-service cancellation control for the subscription or Pass in your account. You may also email <a href={`mailto:${ENTITY.email}?subject=Subscription%20cancellation`}>{ENTITY.email}</a> with the account email, the product you want to cancel and a clear request to cancel. Do not send card details. We will confirm the outcome by email.</p>

            <h2>Duplicate charges</h2>
            <p>Submissions are idempotent: the same request is never debited twice. If you believe you were double-charged, send the job reference to <a href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a> and we will check the ledger.</p>

            <h2>Abuse</h2>
            <p>Refund requests that indicate abuse of the free-credit grant or the service may be declined.</p>
        </LegalPage>
    );
}
