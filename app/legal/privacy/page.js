import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = { title: 'Privacy Policy — Veyrnox.ai' };

export default function Privacy() {
    return (
        <LegalPage title="Privacy Policy">
            <p>{ENTITY.name} (&ldquo;we&rdquo;) is the data controller for personal data processed through Veyrnox.ai. Registered office: {ENTITY.office}. Contact: <a href={`mailto:${ENTITY.privacyEmail}`}>{ENTITY.privacyEmail}</a>.</p>

            <h2>What we collect</h2>
            <ul>
                <li><strong>Account data</strong> — email address, authentication identifiers, and if you sign in with Apple or Google, the identifier they share.</li>
                <li><strong>Usage data</strong> — the prompts and reference files you submit, the generations you request, credit balance and ledger history, and job status.</li>
                <li><strong>Technical data</strong> — IP address, browser and device information, and request logs needed to keep the service secure.</li>
                <li><strong>Payment data</strong> — handled by our payment processor. We never see or store full card numbers.</li>
            </ul>

            <h2>Why we process it</h2>
            <ul>
                <li>To run the service and fulfil your generations (performance of a contract).</li>
                <li>To keep an accurate credit ledger and prevent abuse (legitimate interests).</li>
                <li>To meet legal obligations, including tax and content-provenance requirements.</li>
                <li>To send service messages. We do not send marketing email without consent.</li>
            </ul>

            <h2>Where your data lives</h2>
            <p>Account data and generation metadata are stored in the European Union. Generated media is stored in EU object storage. Your prompts and reference files are transmitted to the third-party model provider that runs the model you selected, for the sole purpose of producing your output.</p>

            <h2>Retention</h2>
            <ul>
                <li>Generated media is kept for 90 days, then deleted automatically.</li>
                <li>Ledger records are kept for as long as your account exists plus the period required by tax law.</li>
                <li>Request logs are kept for a short security window and then discarded.</li>
            </ul>

            <h2>Sharing</h2>
            <p>We share data only with the processors needed to run the service: authentication and database hosting, edge hosting and storage, AI model providers, and payment processing. Each is bound by a data-processing agreement. We do not sell personal data.</p>

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
