import { FAQ, MODELS as MODELS_FALLBACK, kindOf, isShelfModel } from './_lib/tokens';
import { readPublicCatalog } from '../../lib/publicCatalog.js';
import { SITE_URL, JsonLd } from '../seo';
import { Hero, FeaturedHeroCards } from './_sections/hero';
import { BreakthroughVideo, LandingFilm } from './_sections/film';
import { PresetWall, ModelShelf } from './_sections/showcase';
import { LedgerExample, FAQBlock, ClosingCTA, FooterForest } from './_sections/footer';
import { MarketingNav } from './_components/NavBar';
import { SectionJump } from './_components/SectionJump';
import { Main } from './_components/Main';

// FAQPage built from the same FAQ constant the page renders, so the markup
// and the structured data cannot drift apart.
const FAQ_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/#faq`,
  mainEntity: FAQ.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

export const revalidate = 300;

// Landing — credit-metered AI image and video generation.
// The button is the price tag.

/**
 * Server-side read of the live catalog with a hard fallback to tokens.js.
 * Reads through lib/publicCatalog.js, as /api/catalog does — a self-fetch
 * of our own origin does not work inside the Worker and silently served
 * the hardcoded fallback prices.
 */
async function loadCatalog() {
  try {
    const rows = await readPublicCatalog();
    if (rows.length === 0) throw new Error('empty');
    // Only what the picker in app/create will sell to everyone reaches the
    // shelf: the Clip Editor is a Library tool, and Auto Short is still gated.
    // Normalise to the shape our page expects: { id, name, credits, kind, tag?, premium?, gated? }
    return rows.filter((m) => isShelfModel(m.capabilities)).map((m) => ({
      // Lengths the gateway sells, as GET /api/catalog derives them, so the
      // hero slip never offers a 10 s price the studio would refuse.
      durations: m.durations,
      id: m.id,
      name: m.name,
      credits: m.credits,
      // model_catalog.modality is fine-grained (text-to-video, image-to-video,
      // text-to-audio); the page groups on the coarse bucket and keeps the
      // fine-grained value below for display.
      kind: kindOf(m.modality),
      modality: m.modality,
      premium: m.gated,
      gated: m.gated,
      tag: m.gated ? 'PREMIUM' : undefined,
    }));
  } catch {
    return MODELS_FALLBACK;
  }
}

export default async function VeyrnoxLanding() {
  const catalog = await loadCatalog();
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main>
      <BreakthroughVideo />
      <LandingFilm />
      <Hero models={catalog} />
      <FeaturedHeroCards catalog={catalog} />
      <PresetWall catalog={catalog} />
      <ModelShelf catalog={catalog} />
      <LedgerExample catalog={catalog} />
      {/* Same gap above as every other section, and the rule sits on the
          content column: it used to touch the statement section's last line
          and overhang the text by the page gutter on both sides. */}
      <section id="publish" aria-labelledby="publish-title" className="max-w-[1300px] mx-auto px-4 sm:px-6 mt-28 sm:mt-36">
        <div className="border-t border-vx-border pt-16">
        <h2 id="publish-title" className="vx-display text-[36px] sm:text-[48px]">Veyrnox Publish</h2>
        <p className="mt-5 max-w-[68ch] text-vx-fg-body text-[16px] leading-[1.7]">
          Our social publishing workspace is being prepared for release, starting with YouTube.
          Connect your channel, choose a video from your Library, and choose Post now or Schedule post.
          A calendar keeps track of your posts, and basic analytics shows your connected channel and video statistics.
        </p>
        <p className="mt-4 max-w-[68ch] text-vx-fg-body text-[16px] leading-[1.7]">
          Connecting YouTube is a separate consent step from signing in to Veyrnox.ai.
          Videos are sent to your selected channel only when you choose to post or schedule them.
          Read our <a href="/legal/privacy#youtube" className="underline underline-offset-4">YouTube data privacy information</a> and <a href="/legal/terms" className="underline underline-offset-4">Terms</a>.
        </p>
        </div>
      </section>
      <FAQBlock />
      <ClosingCTA />
      </Main>
      <FooterForest catalog={catalog} />
      <JsonLd data={FAQ_LD} />
      <SectionJump />
    </div>
  );
}
