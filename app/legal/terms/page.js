import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = { title: 'Terms of Service — Veyrnox.ai' };

export default function Terms() {
    return (
        <LegalPage title="Terms of Service">
            <p>These terms govern your use of Veyrnox.ai, operated by {ENTITY.name}, a company registered in {ENTITY.jurisdiction} (company no. {ENTITY.companyNo}), registered office {ENTITY.office}. By creating an account or generating content you agree to them.</p>

            <h2>1. The service</h2>
            <p>Veyrnox.ai is a credit-metered service for generating images, video and audio with third-party AI models. Every generation shows its credit cost before you confirm. We may add, remove or re-price models at any time; the price shown at the moment you generate is the price you pay.</p>

            <h2>2. Accounts</h2>
            <ul>
                <li>You must be 18 or over, or the age of majority where you live.</li>
                <li>Keep your login secure. You are responsible for activity under your account.</li>
                <li>One account per person. We may suspend accounts that abuse the free-credit grant.</li>
            </ul>

            <h2>3. Credits</h2>
            <ul>
                <li>New accounts receive 50 free credits. Free credits have no cash value, cannot be withdrawn, are used before purchased credits, and expire 90 days after they are granted if unused.</li>
                <li>Purchased credits never expire.</li>
                <li>Purchased credits are debited when a generation is submitted. If the provider fails to complete the generation, the debit is automatically refunded to your balance. See our <a href="/legal/refund">Refund Policy</a>.</li>
                <li>Credits are not transferable between accounts.</li>
            </ul>

            <h2>4. Your inputs and outputs</h2>
            <ul>
                <li>You keep whatever rights you hold in the prompts and reference files you upload. You grant us a licence to process them solely to run the service.</li>
                <li>Subject to these terms and each underlying model provider&rsquo;s licence, you may use generated outputs for personal and commercial purposes.</li>
                <li>Outputs are AI-generated and carry C2PA content credentials marking them as such, in line with EU AI Act Article 50. You must not remove or alter those credentials.</li>
                <li>You must not use the service to generate unlawful content, content that infringes others&rsquo; rights, sexual content involving minors, non-consensual intimate imagery, or content intended to deceive in a way that causes harm.</li>
            </ul>

            <h2>5. Acceptable use</h2>
            <p>No scraping, reverse-engineering, rate-limit evasion, or reselling access without a written agreement. We may throttle or suspend accounts that put the service or other users at risk.</p>

            <h2>6. Availability</h2>
            <p>The service depends on third-party model providers and may be interrupted. We do not promise uninterrupted access. Failed generations are refunded; nothing more is owed for downtime.</p>

            <h2>7. Liability</h2>
            <p>Nothing in these terms limits liability that cannot be limited by law. Otherwise, our total liability to you in any 12-month period is limited to the amount you paid us in that period. We are not liable for indirect or consequential loss.</p>

            <h2>8. Consumers</h2>
            <p>If you are a consumer in the UK or EU, your statutory rights are not affected by these terms.</p>

            <h2>9. Changes and termination</h2>
            <p>We may update these terms; material changes will be announced on the site at least 14 days before they take effect. You may close your account at any time. We may terminate for breach with notice where practicable.</p>

            <h2>10. Law</h2>
            <p>These terms are governed by the laws of England and Wales. Consumers may also rely on mandatory protections of their home country.</p>

            <h2>Contact</h2>
            <p><a href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a></p>
        </LegalPage>
    );
}
