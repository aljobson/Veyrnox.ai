import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { TemplateCatalog } from '../../_components/TemplateCatalog';
import { publicTemplateCards } from '../../../../lib/clientTemplates.js';
import { MUSIC_DISCOVER_BEATS } from '../../../../lib/musicDiscover.js';
import { VEO_TEMPLATE_RECIPES } from '../../_lib/veoTemplateRecipes.js';

export const metadata = { title: 'Template catalog · Veyrnox.ai' };

export default function TemplatesPage() {
  const kling = publicTemplateCards().filter(card => card.kind !== 'image').map(card => ({
    id: card.id,
    name: card.name,
    category: card.category,
    model: card.model,
    poster: card.clip?.poster || null,
    durationSeconds: card.durationSeconds,
  }));
  const suno = MUSIC_DISCOVER_BEATS.map(beat => ({
    id: beat.id,
    name: beat.title,
    category: beat.mood,
    artwork: beat.artwork,
    bpm: beat.bpm,
    musicalKey: beat.musicalKey,
  }));

  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="templates" />
      <Main className="mx-auto max-w-[1400px] px-4 pb-24 pt-8 sm:px-8 sm:pt-12">
        <header className="max-w-4xl">
          <p className="font-vx-mono text-[11px] font-bold uppercase tracking-[0.16em] text-vx-accent">One catalog · four engines</p>
          <h1 className="vx-display mt-3 text-balance text-[44px] leading-[0.94] sm:text-[68px]">Templates you can actually find</h1>
          <p className="mt-5 max-w-3xl text-pretty text-base leading-7 text-vx-fg-muted">
            Browse Veyrnox-ready Kling templates, the live Seedance effects catalog, Veyrnox-owned Veo prompt recipes, and SUNO music starts. The live provider indexes are read on the server, so your browser never needs a CRUN API key.
          </p>
        </header>
        <TemplateCatalog kling={kling} seedance={[]} veo={VEO_TEMPLATE_RECIPES} suno={suno} />
      </Main>
    </div>
  );
}
