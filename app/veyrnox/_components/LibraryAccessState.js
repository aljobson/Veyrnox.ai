'use client';
import { useI18n } from '../../../components/I18nProvider';

import { AppNav } from './NavBar';
import { Main } from './Main';

export function LibraryAccessState({ loading }) {
  const { t } = useI18n();
  return (
    <div className="min-h-dvh">
      <AppNav active="library" readAccount={false} />
      <Main className="max-w-[1400px] mx-auto px-4 sm:px-8 py-16">
        {loading ? <p role="status" className="text-vx-fg-body">{t("app.library.loading")}</p> : <>
          <h1 className="vx-display text-[36px] sm:text-[48px]">{t("app.library.signIn")}</h1>
          <p className="mt-4 text-vx-fg-body">{t("app.library.signInHelp")}</p>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}
            className="vx-press mt-6 rounded-full bg-vx-accent text-vx-accent-ink px-5 py-2.5 text-sm font-extrabold">
            {t("oauth.signIn")}</button>
        </>}
      </Main>
    </div>
  );
}
