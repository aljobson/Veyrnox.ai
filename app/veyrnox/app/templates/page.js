import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { TemplateCatalog } from '../../_components/TemplateCatalog';
import { publicTemplateCards } from '../../../../lib/clientTemplates.js';
import { MUSIC_DISCOVER_BEATS } from '../../../../lib/musicDiscover.js';
import { VEO_TEMPLATE_RECIPES } from '../../_lib/veoTemplateRecipes.js';
import { getT } from '../../../../lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('app.templates.metaTitle') };
}

export default async function TemplatesPage() {
  const { t } = await getT();
  const kling = publicTemplateCards().filter(card => card.kind !== 'image').map(card => ({
    id: card.id,
    name: card.name,
    category: card.category,
    model: card.model,
    poster: card.clip?.poster || null,
    video: card.clip?.video || null,
    durationSeconds: card.durationSeconds,
  }));
  const suno = MUSIC_DISCOVER_BEATS.map(beat => ({
    id: beat.id,
    name: beat.title,
    category: beat.mood,
    artwork: beat.artwork,
    bpm: beat.bpm,
    musicalKey: beat.musicalKey,
    mood: beat.mood,
    root: beat.root,
    wave: beat.wave,
    bass: beat.bass,
    lead: beat.lead,
  }));

  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="templates" />
      <Main className="mx-auto max-w-[1400px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
        <header className="max-w-4xl">
          <p className="font-vx-mono text-[11px] font-bold uppercase tracking-[0.16em] text-vx-accent">{t('app.templates.eyebrow')}</p>
          <h1 className="vx-display mt-3 text-balance text-[44px] leading-[0.94] sm:text-[68px]">{t('app.templates.title')}</h1>
          <p className="mt-5 max-w-3xl text-pretty text-base leading-7 text-vx-fg-muted">
            {t('app.templates.intro')}
          </p>
        </header>
        <TemplateCatalog kling={kling} seedance={[]} veo={VEO_TEMPLATE_RECIPES} suno={suno} />
      </Main>
    </div>
  );
}
