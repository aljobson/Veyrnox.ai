import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = { title: 'GDPR & Data Rights — Veyrnox.ai' };

export default function Gdpr() {
    return (
        <LegalPage title="GDPR & Data Rights">
            <p>{ENTITY.name} processes personal data under the UK GDPR and, for EU residents, the EU GDPR. This page explains how to exercise your rights.</p>

            <h2>Your rights</h2>
            <ul>
                <li><strong>Access</strong> — a copy of the personal data we hold about you.</li>
                <li><strong>Rectification</strong> — correction of inaccurate data.</li>
                <li><strong>Erasure</strong> — deletion of your account and personal data, subject to records we must keep by law (for example ledger entries needed for tax).</li>
                <li><strong>Portability</strong> — your account and generation metadata in a machine-readable format.</li>
                <li><strong>Restriction and objection</strong> — for processing based on legitimate interests.</li>
                <li><strong>Withdraw consent</strong> — where processing is based on consent.</li>
            </ul>

            <h2>How to make a request</h2>
            <p>Email <a href={`mailto:${ENTITY.privacyEmail}`}>{ENTITY.privacyEmail}</a> from the address on your account. We respond within one month; complex requests may take up to two further months and we will tell you if so. Requests are free unless manifestly unfounded or excessive.</p>

            <h2>Where data is processed</h2>
            <p>Our database, which holds account data, the credit ledger and generation metadata, is currently hosted in the United States. Generated media is stored in Cloudflare R2. Model providers may process your prompt and reference files outside the UK or EEA for the duration of the generation. For every transfer outside the UK or EEA we rely on the UK International Data Transfer Agreement or the EU Standard Contractual Clauses with the processor concerned.</p>

            <h2>Automated decisions</h2>
            <p>We do not make decisions with legal or similarly significant effects about you solely by automated means. Content-safety filtering may block a generation; you can ask us to review a block.</p>

            <h2>Content provenance</h2>
            <p>We do not currently embed content credentials or provenance metadata in generated files, so no personal data of yours is carried inside an output by us. A model provider may embed its own watermark or identifier; that is outside our control and we do not add one on top.</p>

            <h2>Complaints</h2>
            <p>UK: Information Commissioner&rsquo;s Office, ico.org.uk. EU: your local supervisory authority. We would appreciate the chance to resolve any concern first.</p>

            <h2>Controller details</h2>
            <p>{ENTITY.name} · Company no. {ENTITY.companyNo} · {ENTITY.office}</p>
        </LegalPage>
    );
}
