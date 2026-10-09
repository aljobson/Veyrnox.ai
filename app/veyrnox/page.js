import { FAQ, MODELS as MODELS_FALLBACK, kindOf, isShelfModel } from './_lib/tokens';
import { readPublicCatalog } from '../../lib/publicCatalog.js';
import { SITE_URL, JsonLd } from '../seo';
import { WideNav, Hero, FeaturedHeroCards } from './_sections/hero';
import { LandingFilm } from './_sections/film';
import { PresetWall, ModelShelf } from './_sections/showcase';
import { LedgerExample, FAQBlock, ClosingCTA, FooterForest } from './_sections/footer';
import { AnnouncementBar } from './_components/AnnouncementBar';

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
      <AnnouncementBar />
      <WideNav />
      <Hero models={catalog} />
      <LandingFilm />
      <FeaturedHeroCards catalog={catalog} />
      <PresetWall catalog={catalog} />
      <ModelShelf catalog={catalog} />
      <LedgerExample catalog={catalog} />
      <FAQBlock />
      <ClosingCTA />
      <FooterForest catalog={catalog} />
      <JsonLd data={FAQ_LD} />
    </div>
  );
}
