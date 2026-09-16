import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = {
    title: 'Refund Policy',
    description:
        'Exactly when credits come back to your balance: automatic refunds on failed generations, and what happens to purchased credits.',
};

export default function Refund() {
    return (
        <LegalPage title="Refund Policy">
            <p>Veyrnox.ai is pay-per-generation. This page sets out exactly when credits come back to you.</p>

            <h2>Failed generations — automatic</h2>
            <p>Every generation shows its credit cost before you confirm. Credits are debited on submission. If the model provider rejects the job or fails to return a result, the full debit is refunded to your balance automatically, usually within seconds. You do not need to contact us. The refund appears as a separate entry in your ledger.</p>

            <h2>Completed generations</h2>
            <p>Once a generation completes and the output is delivered, the credits are spent. We cannot refund completed generations because the underlying model provider has already charged us for the compute.</p>

            <h2>Free credits</h2>
            <p>The 50 credits granted on sign-up have no cash value, are not refundable in money, and expire 90 days after they are granted if unused. Purchased credits never expire.</p>

            <h2>Purchased credits</h2>
            <p>Credit packs are not on sale yet. When they are, the following applies.</p>
            <ul>
                <li>You can request a full refund of a credit pack within 14 days of purchase, as long as you have not generated anything since that purchase. Once you generate after buying, that purchase can no longer be refunded. Refunds go back to the original payment method, and the credits from that pack are removed from your balance.</li>
                <li>If you are a UK or EU consumer, this does not limit your statutory cancellation rights.</li>
            </ul>

            <h2>Duplicate charges</h2>
            <p>Submissions are idempotent: the same request is never debited twice. If you believe you were double-charged, send the job reference to <a href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a> and we will check the ledger.</p>

            <h2>Abuse</h2>
            <p>Refund requests that indicate abuse of the free-credit grant or the service may be declined.</p>
        </LegalPage>
    );
}
