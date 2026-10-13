import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = {
    title: 'Acceptable Use Policy',
    description:
        'What Veyrnox.ai may and may not be used to generate or publish, including sexual-content, malware, impersonation and consent rules.',
    alternates: { canonical: '/legal/aup' },
};

export default function Aup() {
    return (
        <LegalPage title="Acceptable Use Policy" updated="13 October 2026">
            <p>Veyrnox.ai turns text prompts and uploaded files into images, video, speech and music, and lets approved creators submit work to Social Cinema. These rules apply to every prompt, upload, output and publication and form part of the <a href="/legal/terms">Terms</a>. Social Cinema submissions also follow the <a href="/legal/cinema-content">Cinema Content Policy</a>.</p>

            <h2>You must have the rights to what you upload</h2>
            <p>Before you upload a photo, a video or a recording of a voice, you must either own it or have the permission of everyone identifiable in it. When a generation takes an upload, we ask you to confirm that, and we record the confirmation against that job. Confirming it falsely is a breach of these terms.</p>

            <h2>Prohibited</h2>
            <ul>
                <li><strong>Sexual content.</strong> Pornography, sexually explicit material, sexual violence, fetish content or nudity intended to arouse, whether real, fictional, animated or AI-generated.</li>
                <li><strong>Anything involving minors.</strong> No sexualised, exploitative or abusive depiction of a person under 18, real or generated. This includes childlike characters presented as adults. We may report suspected child sexual abuse material and close the account.</li>
                <li><strong>Impersonation and deepfakes.</strong> Using a real person&apos;s face, body or voice to make them appear to say or do something they did not, including public figures. We do not offer face-swap or voice-cloning tools, and you may not use the tools we do offer to achieve that result.</li>
                <li><strong>Non-consensual intimate imagery</strong> of anyone, and any sexualised depiction of a real, identifiable person.</li>
                <li><strong>Deception.</strong> Passing AI output off as an authentic photograph or recording of a real event, fake news, fake evidence, fake identity documents, or election disinformation.</li>
                <li><strong>Harassment and hate.</strong> Content that threatens, bullies or degrades a person or group, or promotes violence or a hateful ideology.</li>
                <li><strong>Illegal activity</strong> under UK law or the law where you are, including infringing someone else&apos;s copyright or trade mark.</li>
                <li><strong>Malware and unsafe files.</strong> Malware, executable code, macros, scripts, disguised file types, decoder exploits, malicious links or any attempt to compromise another person or the service.</li>
                <li><strong>Malicious use of the platform.</strong> Reselling raw model access, bypassing our rate limits or credit accounting, scraping, or probing our providers&apos; systems.</li>
            </ul>

            <h2>Labelling AI output</h2>
            <p>Everything this service produces is AI-generated. If you publish it somewhere that expects real footage, say that it is AI-generated. Some jurisdictions, including the EU under the AI Act, require that disclosure.</p>

            <h2>How we enforce this</h2>
            <p>We use provider filters and our own automated and human review. Uploads may be quarantined while content, child-safety and malware checks run. A required check that is missing, unavailable or unresolved does not pass. If we find a breach we may refuse a generation or publication, remove content, suspend or close the account, and keep records where the law requires it. Credits attached to a closed account are not refunded where the closure follows a breach of this policy.</p>

            <h2>Reporting</h2>
            <p>To report content or an account, email <a href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a> with the link or job reference. We answer reports about a real person depicted without consent first.</p>

            <h2>Changes</h2>
            <p>We update this policy as the service changes. The date at the top of the page is the version in force.</p>
        </LegalPage>
    );
}
