import { LegalPage, ENTITY } from '../_lib/Legal';
import { SUPPLY_CONSENT_TEXT } from '../../../lib/supplyConsent';

export const metadata = { title: 'Refund Policy — Veyrnox.ai' };

export default function Refund() {
    return (
        <LegalPage title="Refund Policy" updated="13 September 2026">
            <p>Veyrnox.ai is pay-per-generation. This page sets out exactly when credits come back to you.</p>

            <h2>Failed generations — automatic</h2>
            <p>Every generation shows its credit cost before you confirm. Credits are debited on submission. If the model provider rejects the job or fails to return a result, the full debit is refunded to your balance automatically, usually within seconds. You do not need to contact us. The refund appears as a separate entry in your ledger.</p>

            <h2>Completed generations</h2>
            <p>Once a generation completes and the output is delivered, the credits are spent. We cannot refund completed generations because the underlying model provider has already charged us for the compute.</p>

            <h2>Free credits</h2>
            <p>The 50 credits granted on sign-up have no cash value, are not refundable in money, and expire 90 days after they are granted if unused. Purchased credits never expire.</p>

            <h2>Buying credits</h2>
            <p>Credit packs are sold through Stripe, which acts as merchant of record and adds any sales tax or VAT at checkout. Your receipt comes from Onelink, Stripe&rsquo;s checkout and order service, and your card statement shows &ldquo;LINK.COM&rdquo;. Before checkout you tick this confirmation:</p>
            <blockquote className="border-l-2 border-vx-border pl-4 italic">{SUPPLY_CONSENT_TEXT}</blockquote>

            <h2>Refunds of purchased credits</h2>
            <ul>
                <li>You can ask for a refund of a credit pack within 14 days of buying it, as long as you have not generated anything since that purchase. Email <a href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a> with the date of purchase. The money goes back to your original payment method.</li>
                <li>Once you generate after buying, your right to cancel that purchase has ended, as you confirmed at checkout, and we do not refund it.</li>
                <li>Refunds can also be issued by Onelink&rsquo;s customer support. Whoever issues it, a refund takes back that pack&rsquo;s credits in proportion to the money returned &mdash; half the money back removes half the pack&rsquo;s credits, rounded down &mdash; but never takes your balance below zero.</li>
                <li>Nothing here limits your rights if the service is faulty or not as described.</li>
            </ul>

            <h2>Payment reversals and card disputes</h2>
            <p>If you open a card dispute against a purchase, we freeze the account. We also freeze it if a purchase is refunded or reversed and credits have been used since that purchase. While it is frozen you cannot generate or buy credits. You can still sign in, view and download your library, and delete your account. Contact <a href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a> to resolve it; a named member of our team reviews every unfreeze.</p>

            <h2>Duplicate charges</h2>
            <p>Submissions are idempotent: the same request is never debited twice. If you believe you were double-charged, send the job reference to <a href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a> and we will check the ledger.</p>

            <h2>Abuse</h2>
            <p>Refund requests that indicate abuse of the free-credit grant or the service may be declined.</p>
        </LegalPage>
    );
}
