import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = { title: 'Privacy Policy — Veyrnox.ai' };

export default function Privacy() {
    return (
        <LegalPage title="Privacy Policy" updated="13 September 2026">
            <p>{ENTITY.name} (&ldquo;we&rdquo;) is the data controller for personal data processed through Veyrnox.ai. Registered office: {ENTITY.office}. Contact: <a href={`mailto:${ENTITY.privacyEmail}`}>{ENTITY.privacyEmail}</a>.</p>

            <h2>What we collect</h2>
            <ul>
                <li><strong>Account data</strong> — email address, authentication identifiers, and if you sign in with Apple or Google, the identifier they share.</li>
                <li><strong>Usage data</strong> — the prompts and reference files you submit, the generations you request, credit balance and ledger history, and job status.</li>
                <li><strong>Technical data</strong> — IP address, browser and device information, and request logs needed to keep the service secure.</li>
                <li><strong>Purchase data</strong> — when you buy credits: the pack, its price, when you bought it, the confirmation you ticked before checkout and when you ticked it, and the payment and checkout references Stripe sends us, including whether a payment was later refunded or disputed. We never see your card details, and we do not keep the name, email address or billing address you enter at checkout.</li>
            </ul>

            <h2>Why we process it</h2>
            <ul>
                <li>To run the service and fulfil your generations (performance of a contract).</li>
                <li>To keep an accurate credit ledger and prevent abuse (legitimate interests).</li>
                <li>To act on refunds and card disputes, including freezing an account when a card dispute is opened against a purchase, or when a purchase is reversed after its credits were used (legitimate interests in preventing fraud). A named member of our team reviews every unfreeze; contact us to ask for one.</li>
                <li>To meet legal obligations, including tax and content-provenance requirements.</li>
                <li>To send service messages. We do not send marketing email without consent.</li>
            </ul>

            <h2>Where your data lives</h2>
            <p>We run on Supabase for the database and authentication, and on Cloudflare for edge hosting and object storage. Account data, credit ledger and generation metadata sit in our Supabase database, which is currently hosted in the United States. Generated media is stored in Cloudflare R2. Your prompts and reference files are transmitted to the third-party model provider that runs the model you selected, for the sole purpose of producing your output.</p>
            <p>Where your personal data is processed outside the United Kingdom or the EEA, we rely on the UK International Data Transfer Agreement or the EU Standard Contractual Clauses with the processor concerned. If we move the database to another region we will update this page before the move takes effect.</p>

            <h2>Payments</h2>
            <p>Credit packs are sold to you by Stripe, which acts as merchant of record through its Managed Payments service. Your receipt comes from Onelink, Stripe&rsquo;s checkout and order service. Stripe collects your payment details, billing address and tax information at checkout, sends receipts, handles refunds and payment support, and calculates and pays sales tax and VAT. Stripe processes that data under its own privacy policies &mdash; <a href="https://stripe.com/privacy">Stripe</a> and <a href="https://link.com/privacy">Onelink</a> &mdash; not on our instructions. Stripe tells us the outcome of each payment, refund or dispute so we can add or take back credits.</p>

            <h2>Retention</h2>
            <ul>
                <li>Generated media is kept for 90 days, then deleted automatically.</li>
                <li>Ledger records, and the purchase records and checkout confirmations behind them, are kept for as long as your account exists plus the period required by tax law.</li>
                <li>Request logs are kept for a short security window and then discarded.</li>
            </ul>

            <h2>Sharing</h2>
            <p>We share data only with the processors needed to run the service: authentication and database hosting, edge hosting and storage, and AI model providers. Each is bound by a data-processing agreement. When you buy credits, Stripe handles the purchase as merchant of record under its own privacy policies (see Payments), and we share with it only what a checkout needs to identify your purchase. We do not sell personal data.</p>

            <h2>Your rights</h2>
            <p>You can access, correct, export or delete your data, and object to or restrict certain processing. See <a href="/legal/gdpr">GDPR &amp; Data Rights</a> for how. You may also complain to the UK Information Commissioner&rsquo;s Office or your local supervisory authority.</p>

            <h2>Cookies</h2>
            <p>We use only the cookies and local storage strictly necessary to keep you signed in and the service working. No third-party advertising trackers.</p>

            <h2>Children</h2>
            <p>The service is not intended for anyone under 18.</p>

            <h2>Changes</h2>
            <p>We will post material changes here and note the date at the top of this page.</p>
        </LegalPage>
    );
}
