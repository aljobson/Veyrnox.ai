import { LegalPage, ENTITY } from '../_lib/Legal';

export const metadata = {
    title: 'Cinema Content Policy',
    description: 'The content, age-rating and file-safety rules for publishing on Veyrnox Social Cinema.',
    alternates: { canonical: '/legal/cinema-content' },
};

export default function CinemaContentPolicy() {
    return (
        <LegalPage title="Cinema Content Policy" updated="13 October 2026">
            <p>This policy applies to every title, episode, poster, subtitle, audio track, description and other file submitted to Social Cinema. It is part of our <a href="/legal/terms">Terms</a> and <a href="/legal/aup">Acceptable Use Policy</a>.</p>

            <h2>Content we do not allow</h2>
            <ul>
                <li><strong>Sexual content:</strong> pornography, explicit sexual acts, nudity intended to arouse, fetish content, sexual violence or sexual exploitation.</li>
                <li><strong>Children:</strong> any sexualised, exploitative or abusive depiction of a person under 18, whether real, fictional, animated or AI-generated. Apparent age matters; labelling a character as an adult does not make a childlike depiction acceptable.</li>
                <li><strong>Intimate images:</strong> non-consensual intimate imagery, sexual deepfakes, or sexualised depictions of an identifiable real person.</li>
                <li><strong>Severe harm:</strong> content that promotes terrorism, hate, suicide, self-harm, eating disorders, dangerous acts or serious crime; credible threats; or graphic cruelty presented for gratification.</li>
                <li><strong>Deception and abuse:</strong> impersonation, scams, fake evidence, malicious links, privacy violations, harassment or content that infringes another person&apos;s rights.</li>
                <li><strong>Unsafe files:</strong> malware, executable code, macros, scripts, disguised file types, corrupted media intended to exploit a decoder, or links intended to compromise a viewer or the service.</li>
            </ul>

            <h2>Veyrnox audience labels</h2>
            <p>Creators must choose a label and declare every applicable content warning. These are Veyrnox guidance labels, not official BBFC classifications or BBFC symbols.</p>
            <ul>
                <li><strong>All ages:</strong> mild, reassuring material suitable for a general audience.</li>
                <li><strong>PG:</strong> some scenes may be unsuitable for younger or sensitive children; parental guidance is advised.</li>
                <li><strong>12+:</strong> moderate threat, violence, language or mature themes.</li>
                <li><strong>15+:</strong> strong language, violence, horror, drug references or mature themes.</li>
                <li><strong>18+:</strong> strong adult themes or violence that remains within this policy. An 18+ label never permits prohibited sexual content.</li>
            </ul>

            <h2>Review before publication</h2>
            <p>Submissions remain private while automated systems examine metadata, images, sampled video frames, speech or captions, file structure and malware signals. A submission may be sent to a trained reviewer. Automated checks can be wrong, so they assist rather than replace human decisions for uncertain cases.</p>
            <p>We may reject, restrict, suspend or remove content, preserve an audit record, and restrict or close accounts for serious or repeated breaches. We may report suspected illegal content where required by law. We do not publish a title when a required check is missing, unavailable or unresolved.</p>

            <h2>Reports and appeals</h2>
            <p>Report a title or ask us to review a decision at <a href={`mailto:${ENTITY.email}`}>{ENTITY.email}</a>. Include the title link and a short explanation. Do not email illegal imagery or suspected malware.</p>
        </LegalPage>
    );
}
