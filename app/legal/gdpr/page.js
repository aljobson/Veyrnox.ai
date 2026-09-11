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
            <p>Core data is stored in the European Union. Model providers may process your prompt and reference files outside the EU or UK for the duration of the generation; where that happens, transfers rely on the UK International Data Transfer Agreement or EU Standard Contractual Clauses.</p>

            <h2>Automated decisions</h2>
            <p>We do not make decisions with legal or similarly significant effects about you solely by automated means. Content-safety filtering may block a generation; you can ask us to review a block.</p>

            <h2>Content provenance</h2>
            <p>Generated outputs carry C2PA content credentials identifying them as AI-generated, as required by EU AI Act Article 50. These credentials do not contain your personal data.</p>

            <h2>Complaints</h2>
            <p>UK: Information Commissioner&rsquo;s Office, ico.org.uk. EU: your local supervisory authority. We would appreciate the chance to resolve any concern first.</p>

            <h2>Controller details</h2>
            <p>{ENTITY.name} · Company no. {ENTITY.companyNo} · {ENTITY.office}</p>
        </LegalPage>
    );
}
