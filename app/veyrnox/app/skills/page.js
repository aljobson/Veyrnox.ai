import { AppNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { SkillsPanel } from '../../_components/chat/SkillsPanel';
import { getT } from '../../../../lib/i18n/server';

export async function generateMetadata() {
  const { t } = await getT();
  return {
    title: t('label.Studio skills'),
    description: t('app.chat.skills.help'),
    robots: { index: false, follow: false },
  };
}

export default async function SkillsPage() {
  const { t } = await getT();
  return (
    <div className="min-h-dvh bg-vx-base text-vx-fg">
      <AppNav active="skills" />
      <Main className="mx-auto w-full max-w-[1120px] px-4 pb-20 pt-10 sm:px-8 sm:pt-14">
        <header className="mx-auto max-w-[760px] text-center">
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">{t('app.chat.skills.title')}</p>
          <h1 className="vx-display mt-3 text-[38px] leading-[0.98] sm:text-[56px]">{t('label.Studio skills')}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-vx-fg-muted sm:text-base">
            {t('app.chat.skills.help')}
          </p>
        </header>
        <SkillsPanel linkToChat />
      </Main>
    </div>
  );
}
