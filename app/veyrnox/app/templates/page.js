import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { TemplateCatalog } from '../../_components/TemplateCatalog';
import { readyTemplateCatalog } from '../../_lib/templateCatalogReady.js';
import { getT } from '../../../../lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t('app.templates.metaTitle') };
}

export default async function TemplatesPage() {
  const { t } = await getT();
  const catalog = readyTemplateCatalog();

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
        <TemplateCatalog {...catalog} />
      </Main>
    </div>
  );
}
