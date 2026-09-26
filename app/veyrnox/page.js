import { FAQ, MODELS as MODELS_FALLBACK, kindOf, isShelfModel } from './_lib/tokens';
import { select, envConfig } from '../../packages/db/supabase-client.js';
import { capabilityFor } from '../../lib/modelCapabilities.js';
import { SITE_URL, JsonLd } from '../seo';
import { PromoStrip, WideNav, FeaturedHeroCards, SignupIncentive } from './_sections/hero';
import { ProductTilesRow, HeroStatement, EffectsWall, ModelShelf } from './_sections/showcase';
import { WhyVeyrnox, FeatureStripsSection, FAQBlock, ClosingCTA, FooterForest } from './_sections/footer';

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
 * Queries Postgres directly (same columns as /api/catalog) — a self-fetch
 * of our own origin does not work inside the Worker and silently served
 * the hardcoded fallback prices.
 */
async function loadCatalog() {
  try {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error('not_configured');
    const rows = await select(
      'model_catalog',
      { columns: 'id,name,modality,credits_5s,gated_flag,provider_endpoint', filter: 'active=eq.true&order=modality.asc,name.asc' },
      cfg,
    );
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('empty');
    // Only what the picker in app/create will sell to everyone reaches the
    // shelf: the Clip Editor is a Library tool, and Auto Short is still gated.
    // Normalise to the shape our page expects: { id, name, credits, kind, tag?, premium?, gated? }
    return rows.filter((m) => isShelfModel(capabilityFor(m.provider_endpoint))).map((m) => ({
      id: m.id,
      name: m.name,
      credits: m.credits_5s,
      // model_catalog.modality is fine-grained (text-to-video, image-to-video,
      // text-to-audio); the page groups on the coarse bucket and keeps the
      // fine-grained value below for display.
      kind: kindOf(m.modality),
      modality: m.modality,
      premium: !!m.gated_flag,
      gated: !!m.gated_flag,
      tag: m.gated_flag ? 'PREMIUM' : undefined,
    }));
  } catch {
    return MODELS_FALLBACK;
  }
}

export default async function VeyrnoxLanding() {
  const catalog = await loadCatalog();
  return (
    <div className="min-h-dvh">
      <PromoStrip />
      <WideNav />
      <FeaturedHeroCards />
      <SignupIncentive />
      <ProductTilesRow modelCount={catalog.length} catalog={catalog} />
      <HeroStatement />
      <EffectsWall />
      <ModelShelf catalog={catalog} />
      <WhyVeyrnox />
      <FeatureStripsSection />
      <FAQBlock />
      <ClosingCTA modelCount={catalog.length} />
      <FooterForest catalog={catalog} />
      <JsonLd data={FAQ_LD} />
    </div>
  );
}
