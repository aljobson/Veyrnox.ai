import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = {
    title: 'Privacy Policy',
    description:
        'What personal data Veyrnox.ai processes, why, where it is stored, and how long it is kept.',
    alternates: { canonical: '/legal/privacy' },
};

export default function Privacy() {
    return (
        <LegalPage title="Privacy Policy" updated="24 September 2026">
            <p>{ENTITY.name} (&ldquo;we&rdquo;) is the data controller for personal data processed through Veyrnox.ai. Registered office: {ENTITY.office}. Contact: <a href={`mailto:${ENTITY.privacyEmail}`}>{ENTITY.privacyEmail}</a>.</p>

            <h2>What we collect</h2>
            <ul>
                <li><strong>Account data</strong> — email address, authentication identifiers, and if you sign in with Apple or Google, the identifier they share.</li>
                <li><strong>Usage data</strong> — the prompts and reference files you submit, the generations you request, credit balance and ledger history, and job status.</li>
                <li><strong>Technical data</strong> — IP address, browser and device information, and request logs needed to keep the service secure.</li>
                <li><strong>Payment data</strong> — credit packs are sold through Stripe Managed Payments, under which Stripe, Inc. is the Merchant of Record and seller of record, and charges and remits any VAT or sales tax. Stripe collects your payment details, billing address and any tax information as its own controller, under its own privacy policy. We receive the payment reference, amount, currency, country and email so we can add the credits to your account. We never see or store full card numbers.</li>
            </ul>

            <h2>Why we process it</h2>
            <ul>
                <li>To run the service and fulfil your generations (performance of a contract).</li>
                <li>To keep an accurate credit ledger and prevent abuse (legitimate interests).</li>
                <li>To meet legal obligations, including tax and content-provenance requirements.</li>
                <li>To send service messages. We do not send marketing email without consent.</li>
            </ul>

            <h2>Where your data lives</h2>
            <p>We run on Supabase for the database and authentication, and on Cloudflare for edge hosting and object storage. Account data, credit ledger and generation metadata sit in our Supabase database, which is hosted in the European Union (Frankfurt, Germany). Generated media is stored in the European Union, in Cloudflare R2 with an EU jurisdictional restriction. Your prompts and reference files are transmitted to the third-party model provider that runs the model you selected, for the sole purpose of producing your output.</p>
            <p>Some of the companies that process your personal data are outside the United Kingdom and the EEA: our edge hosting, the model providers, and Stripe, Inc. (United States), which is the Merchant of Record for credit pack purchases. Where your personal data is processed outside the United Kingdom or the EEA, we rely on the UK International Data Transfer Agreement or the EU Standard Contractual Clauses with the company concerned. If we move the database to another region we will update this page before the move takes effect.</p>

            <h2>Retention</h2>
            <ul>
                <li>Generated media is kept for 90 days, then deleted automatically.</li>
                <li>Ledger records are kept for as long as your account exists plus the period required by tax law.</li>
                <li>Request logs are kept for a short security window and then discarded.</li>
            </ul>

            <h2>Sharing</h2>
            <p>We share data only with the companies needed to run the service: authentication and database hosting, edge hosting and storage, AI model providers, and Stripe, Inc. for credit pack purchases. Each of our processors is bound by a data-processing agreement; Stripe, Inc. acts as its own controller for the purchase it makes as Merchant of Record. We do not sell personal data.</p>

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
