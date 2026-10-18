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
import { LanguageSwitcher } from './_components/LanguageSwitcher';
import { getT } from '../../lib/i18n/server';
import { LOCALES, languageAlternates, localeInfo, localesEnabled } from '../../lib/i18n/locales.mjs';
import { rich } from '../../lib/i18n/rich';
import { OG_IMAGE, OPEN_GRAPH_BASE } from '../seo';

// FAQPage built from the same messages the page renders, so the markup and
// the structured data cannot drift apart.
function faqLd(t, locale) {
  const path = locale === 'en' ? '' : `/${locale}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${SITE_URL}${path}/#faq`,
    inLanguage: localeInfo(locale).hreflang,
    mainEntity: FAQ.map((_, i) => ({
      '@type': 'Question',
      name: t(`home.faq.${i}.q`),
      acceptedAnswer: { '@type': 'Answer', text: t(`home.faq.${i}.a`) },
    })),
  };
}

// Title, description and the per-language alternates (ADR-0107). With
// languages off this is the same as the root layout's defaults.
export async function generateMetadata() {
  const { locale, t } = await getT();
  if (!localesEnabled()) return {};
  const path = locale === 'en' ? '/' : `/${locale}`;
  const title = t('meta.title');
  const description = t('meta.description');
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path, languages: languageAlternates('/') },
    openGraph: { ...OPEN_GRAPH_BASE, title, description, url: path, locale: localeInfo(locale).og, alternateLocale: LOCALES.filter((l) => l.code !== locale).map((l) => l.og) },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
  };
}

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
    // Normalise to the shape our page expects. Preserve capability signals
    // used by the starter selector so upload-only models are never presented
    // as a prompt-first option when live prices reorder the catalog.
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
      presentation: m.capabilities?.presentation || {},
      media: m.capabilities?.media || {},
      takesPrompt: !!m.capabilities?.inputs?.prompt,
      takesPlan: !!m.capabilities?.inputs?.plan_id,
      takesTopic: !!m.capabilities?.inputs?.topic,
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
  const { locale, t } = await getT();
  return (
    <div className="min-h-dvh">
      <MarketingNav hideAnnouncementOnMobile />
      <Main>
      <Hero models={catalog} />
      <BreakthroughVideo />
      <LandingFilm />
      <FeaturedHeroCards catalog={catalog} />
      <PresetWall catalog={catalog} />
      <ModelShelf catalog={catalog} />
      <LedgerExample catalog={catalog} locale={locale} />
      {/* Same gap above as every other section, and the rule sits on the
          content column: it used to touch the statement section's last line
          and overhang the text by the page gutter on both sides. */}
      <section id="publish" aria-labelledby="publish-title" className="max-w-[1300px] mx-auto px-4 sm:px-6 mt-28 sm:mt-36">
        <div className="border-t border-vx-border pt-16">
        <h2 id="publish-title" className="vx-display text-[36px] sm:text-[48px]">{t('home.publish.title')}</h2>
        <p className="mt-5 max-w-[68ch] text-vx-fg-body text-[16px] leading-[1.7]">
          {t('home.publish.p1')}
        </p>
        <p className="mt-4 max-w-[68ch] text-vx-fg-body text-[16px] leading-[1.7]">
          {rich(t('home.publish.p2'), {
            privacy: <a href="/legal/privacy#youtube" className="underline underline-offset-4">{t('home.publish.privacy')}</a>,
            terms: <a href="/legal/terms" className="underline underline-offset-4">{t('home.publish.terms')}</a>,
          })}
        </p>
        <p className="mt-6">
          <a href="/publish" className="font-bold underline underline-offset-4 hover:text-vx-accent">{t('home.publish.more')} →</a>
        </p>
        </div>
      </section>
      <FAQBlock locale={locale} />
      <ClosingCTA locale={locale} />
      </Main>
      <FooterForest locale={locale} />
      {localesEnabled() && <LanguageSwitcher locale={locale} path="/" />}
      <JsonLd data={faqLd(t, locale)} />
      <SectionJump />
    </div>
  );
}
