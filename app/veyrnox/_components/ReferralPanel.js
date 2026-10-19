'use client';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';

import { useEffect, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';
import { CopyButton } from './CopyButton';

// ADR-0071: the signed-in account's own referral link and how many friends joined through it. Shows nothing while the feature is off.
export function ReferralPanel() {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let live = true;
    gatewayFetch('/referrals')
      .then((r) => { if (live && r && r.enabled && typeof r.code === 'string') setInfo({ code: r.code, referred: Number.isInteger(r.referred) ? r.referred : 0 }); })
      .catch(() => {}); // no panel is the safe answer
    return () => { live = false; };
  }, []);
  if (!info) return null;
  const link = `${window.location.origin}/?ref=${info.code}`;
  return (
    <section className="rounded-2xl border border-vx-border p-5" aria-labelledby="refer-heading">
      <h2 id="refer-heading" className="font-bold mb-2">{t("app.account.referral.title")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">
        {t("app.account.referral.policy")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <input readOnly aria-label={t("app.account.referral.link")} value={link} onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
        <CopyButton value={link} label={t("cinema.share.copyLink")} title={t("app.account.referral.copy")} />
      </div>
      <p className="text-sm text-vx-fg-muted mt-3">
        {t(pluralKey(t, locale, 'app.account.referral.joined', info.referred), { count: locale === 'en' ? info.referred : info.referred.toLocaleString(localeTag(locale)) })}
      </p>
    </section>
  );
}
